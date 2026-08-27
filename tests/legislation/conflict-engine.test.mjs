import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  blockedActions,
  conflictFingerprint,
  detectConflicts,
  loadLegislationPolicy,
} from '../../src/legislation/index.mjs';

const policy = loadLegislationPolicy({ dir: path.join(process.cwd(), 'config') });

/**
 * سياسةٌ مصغَّرة: الحقولُ التي يقرؤها الكشفُ فقط، كي يكون الاختبارُ على
 * التقاطع لا على تحميل الحزمة.
 * @param {Partial<import('../../src/policy/model.mjs').PolicyRecord> & { id: string }} over
 * @returns {import('../../src/policy/model.mjs').PolicyRecord}
 */
function policyRecord(over) {
  return /** @type {import('../../src/policy/model.mjs').PolicyRecord} */ (
    Object.freeze({
      name: over.id,
      owner: 'role:king',
      version: 1,
      effect: 'allow',
      priority: 50,
      reason: 'سياسةُ اختبار',
      enabled: true,
      actors: { roles: ['role:operator'] },
      actions: ['run-task'],
      resources: ['task'],
      ...over,
    })
  );
}

/**
 * @param {readonly import('../../src/policy/model.mjs').PolicyRecord[]} policies
 * @returns {import('../../src/policy/loader.mjs').PolicyBundle}
 */
function bundleOf(policies) {
  return /** @type {import('../../src/policy/loader.mjs').PolicyBundle} */ (
    /** @type {unknown} */ ({
      actions: new Map(),
      policies,
      roles: new Map(),
      threshold: [],
      quotas: [],
      versions: { policies: 1, roles: 1, royalAuthority: 1, quotas: 1 },
    })
  );
}

test('قانونان متعاكسا الأثر على تقاطعٍ واقع: تعارضٌ مانعٌ يُكشف ويمنع الفعل', () => {
  const bundle = bundleOf([
    policyRecord({ id: 'pol:allow-run', effect: 'allow', priority: 60 }),
    policyRecord({ id: 'pol:deny-run', effect: 'deny', priority: 40 }),
  ]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:allow-run'], scope: 'operations' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:deny-run'], scope: 'operations' },
    ],
  });
  const found = conflicts.find((entry) => entry.kind === 'effect-contradiction');
  assert.ok(found !== undefined, 'التضادُّ في الأثر يُكشف');
  assert.equal(found.code, 'LEGISLATION_CONFLICT_EFFECT');
  assert.equal(found.blocking, true);
  assert.equal(found.certain, true);
  assert.deepEqual([...found.lawIds], ['law:a', 'law:b']);
  assert.deepEqual([...blockedActions(conflicts)], ['run-task']);
});

test('الأولويةُ المتساوية نوعٌ آخر: الحسمُ بترتيب المعرّفات لا بقرار', () => {
  const bundle = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 50 }),
    policyRecord({ id: 'pol:b', effect: 'deny', priority: 50 }),
  ]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'operations' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'operations' },
    ],
  });
  const kinds = conflicts.map((entry) => entry.kind);
  assert.ok(kinds.includes('priority-tie'), 'التساوي في الأولوية يُسمّى نوعاً بعينه');
  assert.ok(!kinds.includes('effect-contradiction'), 'ولا يُبلَّغ نوعان عن تقاطعٍ واحد');
});

test('الشرطُ يُضيّق فيصير التقاطعُ محتملاً لا مانعاً', () => {
  const bundle = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 60 }),
    policyRecord({
      id: 'pol:b',
      effect: 'deny',
      priority: 40,
      conditions: [{ attribute: 'actor.state', operator: 'eq', value: 'quarantined' }],
    }),
  ]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'operations' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'operations' },
    ],
  });
  const found = conflicts.find((entry) => entry.kind === 'effect-contradiction');
  assert.ok(found !== undefined);
  assert.equal(found.certain, false, 'شرطٌ يضيّق ⇒ تقاطعٌ محتمل');
  assert.equal(found.blocking, false, 'والمحتملُ يُعلَن ولا يمنع');
  assert.equal(blockedActions(conflicts).size, 0);
});

test('لا تقاطعَ عند اختلاف النطاق أو المَورِد', () => {
  const bundle = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', scopes: ['operations'] }),
    policyRecord({ id: 'pol:b', effect: 'deny', scopes: ['finance'] }),
  ]);
  const scoped = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'operations' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'finance' },
    ],
  });
  assert.equal(scoped.length, 0, 'نطاقان لا يلتقيان لا يُنشئان تعارضاً');

  const other = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', resources: ['task'] }),
    policyRecord({ id: 'pol:b', effect: 'deny', resources: ['model'] }),
  ]);
  const byResource = detectConflicts({
    policy,
    bundle: other,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'all' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'all' },
    ],
  });
  assert.equal(byResource.length, 0, 'مَورِدان مختلفان لا يلتقيان');
});

test('النمطُ العام يلتقي بالخاص: * و`task:*` تقاطعٌ لا انفصال', () => {
  const bundle = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 60, resources: ['*'] }),
    policyRecord({ id: 'pol:b', effect: 'deny', priority: 30, resources: ['task:critical'] }),
  ]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'all' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'all' },
    ],
  });
  assert.ok(
    conflicts.some((entry) => entry.kind === 'effect-contradiction'),
    'نمطٌ عامٌّ ونمطٌ خاصٌّ يتقاطعان',
  );
});

test('سياسةٌ واحدةٌ لقانونين: تعارضُ سندٍ مزدوجٍ يُكشف ويمنع', () => {
  const bundle = bundleOf([policyRecord({ id: 'pol:shared' })]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:shared'], scope: 'all' },
      { id: 'law:b', articleId: 'art:06', policyIds: ['pol:shared'], scope: 'all' },
    ],
  });
  const found = conflicts.find((entry) => entry.kind === 'shared-policy');
  assert.ok(found !== undefined);
  assert.equal(found.code, 'LEGISLATION_CONFLICT_SHARED_POLICY');
  assert.equal(found.blocking, true);
});

test('الاستنادُ إلى المادة نفسِها يُعلَن ولا يمنع', () => {
  const bundle = bundleOf([policyRecord({ id: 'pol:a' }), policyRecord({ id: 'pol:b' })]);
  const conflicts = detectConflicts({
    policy,
    bundle,
    laws: [
      { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'all' },
      { id: 'law:b', articleId: 'art:05', policyIds: ['pol:b'], scope: 'all' },
    ],
  });
  const found = conflicts.find((entry) => entry.kind === 'article-collision');
  assert.ok(found !== undefined);
  assert.equal(found.blocking, false);
  assert.equal(blockedActions(conflicts).size, 0, 'المُعلَنُ غيرُ المانع لا يمنع فعلاً');
});

test('سياسةٌ معلَّقةٌ لا تُنشئ تعارضاً، والبصمةُ تُقارن قبل الحلِّ وبعده', () => {
  const live = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 60 }),
    policyRecord({ id: 'pol:b', effect: 'deny', priority: 40 }),
  ]);
  const laws = [
    { id: 'law:a', articleId: 'art:05', policyIds: ['pol:a'], scope: 'all' },
    { id: 'law:b', articleId: 'art:06', policyIds: ['pol:b'], scope: 'all' },
  ];
  const before = conflictFingerprint(detectConflicts({ policy, bundle: live, laws }));
  assert.notEqual(before, '', 'البصمةُ غيرُ فارغةٍ ما دام التعارضُ قائماً');

  const suspended = bundleOf([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 60 }),
    policyRecord({ id: 'pol:b', effect: 'deny', priority: 40, enabled: false }),
  ]);
  const after = conflictFingerprint(detectConflicts({ policy, bundle: suspended, laws }));
  assert.equal(after, '', 'تعليقُ السياسة يُزيل التعارضَ فتفرغ البصمة');
});
