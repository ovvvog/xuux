// اختبارات السلطة التشريعية (M8.02).
//
// معيارُ القبول المُعلَن في خارطة الطريق يُشترى هنا بمسارٍ واقعٍ لا بمحاكاة:
// قانونان متعارضان ⇒ يُكشف التعارضُ **ويُمنع الإنفاذُ فعلاً** عبر
// `EnforcementPoint`، ثم يُحَلُّ بأمرٍ ملكيٍّ موقَّعٍ فيعود الفعلُ مسموحاً.
// ولذلك تُركَّب بوابةُ تاجٍ حقيقية (مفتاحٌ وشهادةٌ وتوقيع) لا كائنٌ مزيَّف:
// «اعتمادُ التاج» كان مقارنةَ نصٍّ قبل هذه الخطوة، فاختبارُه بمزيَّفٍ يُعيد العيب.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { LawRegistry, LawState } from '../../src/governance/index.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createMemoryRepositories, createRegistries } from '../../src/persistence/composition.mjs';
import { PolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { createGovernance } from '../../src/policy/governance.mjs';
import {
  Legislature,
  enforcementGate,
  loadLegislationPolicy,
} from '../../src/legislation/index.mjs';

const LEGISLATION_POLICY = loadLegislationPolicy({ dir: path.join(process.cwd(), 'config') });

/** الموادُّ التي يقبلها الربطُ في هذه الاختبارات: معرّفٌ ومرجعُ قانون. */
const ARTICLES = Object.freeze([
  Object.freeze({ id: 'art:05', lawRef: 'law:legislation' }),
  Object.freeze({ id: 'art:06', lawRef: 'law:legislation' }),
  Object.freeze({ id: 'art:07', lawRef: 'law:audit' }),
]);

const TEXT = 'ن'.repeat(200);

/**
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
      lawRef: 'law:legislation',
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
      actions: new Map([
        [
          'run-task',
          { id: 'run-task', sensitive: false, resource: 'task', description: 'فعلُ اختبار' },
        ],
      ]),
      policies,
      roles: new Map([['role:operator', { id: 'role:operator', capabilities: [] }]]),
      threshold: [],
      quotas: [],
      versions: { policies: 1, roles: 1, royalAuthority: 1, quotas: 1 },
    })
  );
}

/**
 * يُركّب دولةً مصغَّرةً: سجلٌّ، تاجٌ حقيقي، مستودعُ قوانين، وسلطةٌ تشريعية.
 * @param {readonly import('../../src/policy/model.mjs').PolicyRecord[]} policies
 */
function state(policies) {
  const log = new EventLog();
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log);
  const laws = new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
  const bundle = bundleOf(policies);
  const legislature = new Legislature({
    policy: LEGISLATION_POLICY,
    bundle,
    articles: ARTICLES,
    laws,
    log,
    crown,
  });
  return { log, king, crown, laws, bundle, legislature };
}

/**
 * @param {import('../../src/governance/index.mjs').LawRegistry} laws
 * @param {string} title
 * @param {string} [scope]
 */
async function proposed(laws, title, scope = 'operations') {
  const law = await laws.propose({ title, text: TEXT, scope, proposer: 'role:minister' });
  await laws.transition(law.id, LawState.PROPOSED, 'role:minister');
  return law.id;
}

/**
 * أمرٌ ملكيٌّ موقَّعٌ فعلاً.
 * @param {KingIdentity} king
 * @param {string} action
 * @param {string} target
 */
function command(king, action, target) {
  const cmd = createRoyalCommand(action, target);
  return { command: cmd, signature: king.sign(cmd) };
}

test('النفاذ يقتضي مادةً قائمةً وسياسةً مفعَّلةً ومرجعاً متطابقاً', async () => {
  const s = state([
    policyRecord({ id: 'pol:a' }),
    policyRecord({ id: 'pol:sleeping', enabled: false }),
    policyRecord({ id: 'pol:other', lawRef: 'law:audit' }),
  ]);
  const id = await proposed(s.laws, 'قانونُ الفحص');

  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:99',
        policyIds: ['pol:a'],
        ...command(s.king, 'enact-law', id),
      }),
    /LEGISLATION_ARTICLE_UNKNOWN/,
  );
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: [],
        ...command(s.king, 'enact-law', id),
      }),
    /LEGISLATION_BINDING_REQUIRED/,
  );
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:ghost'],
        ...command(s.king, 'enact-law', id),
      }),
    /LEGISLATION_POLICY_UNKNOWN/,
  );
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:sleeping'],
        ...command(s.king, 'enact-law', id),
      }),
    /LEGISLATION_POLICY_DISABLED/,
  );
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:other'],
        ...command(s.king, 'enact-law', id),
      }),
    /LEGISLATION_LAWREF_MISMATCH/,
  );

  const { law } = await s.legislature.enact({
    lawId: id,
    articleId: 'art:05',
    policyIds: ['pol:a'],
    ...command(s.king, 'enact-law', id),
  });
  assert.equal(law['state'], LawState.ENACTED);
  assert.equal(law['articleId'], 'art:05');
  assert.deepEqual(law['policyIds'], ['pol:a']);
  const bound = await s.legislature.bound();
  assert.equal(bound.length, 1);
  assert.ok(
    s.log.snapshot().some((entry) => entry.type === 'law.bound'),
    'الربطُ واقعةٌ في السجل',
  );
});

test('النفاذ لا يقع بمقارنةِ اسمٍ: أمرٌ بفعلٍ غيرِ فعلِ النفاذ أو على غيرِ هدفه مرفوض', async () => {
  const s = state([policyRecord({ id: 'pol:a' })]);
  const id = await proposed(s.laws, 'قانونُ السلطة');
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:a'],
        ...command(s.king, 'inspect', id),
      }),
    /LEGISLATION_ROYAL_COMMAND_REQUIRED/,
  );
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:a'],
        ...command(s.king, 'enact-law', 'law:another'),
      }),
    /LEGISLATION_ROYAL_COMMAND_REQUIRED/,
  );
  const forged = createRoyalCommand('enact-law', id);
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:a'],
        command: forged,
        signature: 'ff'.repeat(32),
      }),
    /INVALID_ROYAL_SIGNATURE/,
  );
  assert.equal((await s.legislature.bound()).length, 0, 'ولا يبقى أثرُ نفاذٍ من محاولةٍ مرفوضة');
});

test('نفاذٌ يُنشئ تعارضاً مانعاً يُرفض ويُبلَّغ عنه قبل الرفض', async () => {
  const s = state([
    policyRecord({ id: 'pol:allow', effect: 'allow', priority: 70 }),
    policyRecord({ id: 'pol:deny', effect: 'deny', priority: 20 }),
  ]);
  const first = await proposed(s.laws, 'قانونُ السماح');
  await s.legislature.enact({
    lawId: first,
    articleId: 'art:05',
    policyIds: ['pol:allow'],
    ...command(s.king, 'enact-law', first),
  });
  const second = await proposed(s.laws, 'قانونُ المنع');
  await assert.rejects(
    () =>
      s.legislature.enact({
        lawId: second,
        articleId: 'art:06',
        policyIds: ['pol:deny'],
        ...command(s.king, 'enact-law', second),
      }),
    /LEGISLATION_CONFLICT_UNRESOLVED/,
  );
  const detected = s.log.snapshot().filter((entry) => entry.type === 'law.conflict.detected');
  assert.equal(detected.length, 1, 'التعارضُ المكشوفُ واقعةٌ لا رسالةُ خطأٍ فقط');
  assert.equal((await s.legislature.bound()).length, 1, 'ولا يَنفُذ الثاني');
});

test('معيارُ القبول: قانونان متعارضان ⇒ كشفٌ ومنعُ إنفاذٍ حتى الحلّ', async () => {
  // القانونان يُصبحان نافذين معاً لأنّ السياستين تتقاطعان **بعد** نفاذهما:
  // الثانية تُفعَّل بتعديل الحزمة، وهو ما يحدث في الواقع (سياسةٌ تُعدَّل بعد
  // نفاذ قانونها) وهو المسارُ الذي كان يُحسم صامتاً بغَلَبة الرفض.
  const s = state([
    policyRecord({ id: 'pol:allow', effect: 'allow', priority: 70 }),
    policyRecord({ id: 'pol:deny', effect: 'deny', priority: 20, resources: ['report'] }),
  ]);
  const first = await proposed(s.laws, 'قانونُ التشغيل');
  await s.legislature.enact({
    lawId: first,
    articleId: 'art:05',
    policyIds: ['pol:allow'],
    ...command(s.king, 'enact-law', first),
  });
  const second = await proposed(s.laws, 'قانونُ التقارير');
  await s.legislature.enact({
    lawId: second,
    articleId: 'art:06',
    policyIds: ['pol:deny'],
    ...command(s.king, 'enact-law', second),
  });
  assert.equal((await s.legislature.bound()).length, 2);
  assert.equal((await s.legislature.blocked()).size, 0, 'قبل التعديل لا تقاطعَ ولا منع');

  // التعديل: السياسةُ الثانية تمتدُّ إلى المَورِد نفسِه فينشأ التضادّ.
  const widened = s.bundle.policies.map((entry) =>
    entry.id === 'pol:deny' ? policyRecord({ ...entry, resources: ['task'] }) : entry,
  );
  s.legislature.bundle = bundleOf(widened);

  const conflicts = await s.legislature.conflicts();
  const blocking = conflicts.filter((entry) => entry.blocking);
  assert.ok(blocking.length > 0, 'الكشفُ يقع على القانونين النافذين');
  assert.ok(
    blocking.some((entry) => entry.code === 'LEGISLATION_CONFLICT_EFFECT'),
    'وبرمزٍ مسمّى',
  );
  assert.ok((await s.legislature.blocked()).has('run-task'), 'والفعلُ المتقاطعُ ممنوع');

  // المنعُ في المسار الواقع: نقطةُ الإنفاذ نفسُها ترفض.
  const point = new EnforcementPoint({
    decisionPoint: new PolicyDecisionPoint({ bundle: s.legislature.bundle }),
    log: s.log,
    legislationGate: enforcementGate(s.legislature),
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
  const request = {
    actor: Object.freeze({ id: 'agent:one', role: 'role:operator', kind: 'agent' }),
    action: 'run-task',
    resource: Object.freeze({ id: 'task:one', type: 'task', scope: 'operations' }),
    scope: 'operations',
  };
  const blocked = await point.authorize(/** @type {never} */ (request));
  assert.equal(blocked.decision.allowed, false);
  assert.equal(blocked.decision.code, 'LEGISLATION_CONFLICT_UNRESOLVED');
  assert.equal(blocked.token, null, 'ولا تُصدَر تذكرةُ تنفيذ');
  assert.ok(
    s.log.snapshot().some((entry) => entry.type === 'law.enforcement.blocked'),
    'والمنعُ واقعةٌ يقرؤها الفاحص',
  );

  // الحلُّ أمرٌ ملكيٌّ موقَّعٌ بسببٍ مكتوب، ويُقاس بزوال أثره.
  const resolution = await s.legislature.resolve({
    lawId: second,
    reason: 'يُعلَّق قانونُ التقارير حتى يُعاد صوغُ سياسته بلا تقاطعٍ مع قانون التشغيل.',
    ...command(s.king, 'resolve-law-conflict', second),
  });
  assert.notEqual(resolution.before, '');
  assert.equal(resolution.after, '', 'زوالُ التعارض مقيسٌ لا معلَن');
  assert.ok(resolution.resolved > 0);
  assert.equal((await s.legislature.blocked()).size, 0);

  // وبعد الحلّ يرتفع المنعُ عن المسار نفسِه.
  const after = await point.authorize(/** @type {never} */ (request));
  assert.notEqual(
    after.decision.code,
    'LEGISLATION_CONFLICT_UNRESOLVED',
    'الحاجزُ يرتفع بزوال التعارض لا بإعلان حلّ',
  );
  assert.ok(
    s.log.snapshot().some((entry) => entry.type === 'law.conflict.resolved'),
    'والحلُّ واقعةٌ في السجل',
  );
  // **حدٌّ معلَن يُقاس هنا ولا يُستر:** تعليقُ القانون يُزيل التعارضَ
  // التشريعي، ولا يُعطّل السياسةَ نفسَها: السياساتُ ملفٌّ موقَّع لا صفوفٌ
  // تُحدَّث بأمر. فالمنعُ الباقي بعد الحلّ منشأُه `pol:deny` لا التعارض.
  assert.equal(after.decision.allowed, false);
  assert.equal(after.decision.policyId, 'pol:deny', 'الرفضُ الباقي سياسيٌ لا تشريعي');

  // ومتى لحقت السياسةُ قانونَها المُعلَّق عاد الفعلُ منفَّذاً في المسار نفسِه.
  const amended = bundleOf(
    s.legislature.bundle.policies.map((entry) =>
      entry.id === 'pol:deny' ? policyRecord({ ...entry, enabled: false }) : entry,
    ),
  );
  s.legislature.bundle = amended;
  const restored = new EnforcementPoint({
    decisionPoint: new PolicyDecisionPoint({ bundle: amended }),
    log: s.log,
    legislationGate: enforcementGate(s.legislature),
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
  const allowed = await restored.authorize(/** @type {never} */ (request));
  assert.equal(allowed.decision.allowed, true, 'وبعد الحلّ وتعديلِ السياسة يُنفَّذ الفعل');
  assert.notEqual(allowed.token, null, 'وتُصدَر تذكرةُ تنفيذ');
});

test('حلٌّ لا يُزيل شيئاً مرفوضٌ، وحلٌّ بلا سببٍ مُفصَّلٍ مرفوض', async () => {
  const s = state([
    policyRecord({ id: 'pol:a', effect: 'allow', priority: 70 }),
    policyRecord({ id: 'pol:b', effect: 'deny', priority: 20, resources: ['report'] }),
    policyRecord({ id: 'pol:c', effect: 'allow', priority: 40, resources: ['model'] }),
  ]);
  const first = await proposed(s.laws, 'قانونٌ أول');
  await s.legislature.enact({
    lawId: first,
    articleId: 'art:05',
    policyIds: ['pol:a'],
    ...command(s.king, 'enact-law', first),
  });
  const second = await proposed(s.laws, 'قانونٌ ثانٍ');
  await s.legislature.enact({
    lawId: second,
    articleId: 'art:06',
    policyIds: ['pol:b'],
    ...command(s.king, 'enact-law', second),
  });
  const third = await proposed(s.laws, 'قانونٌ ثالث');
  await s.legislature.enact({
    lawId: third,
    articleId: 'art:06',
    policyIds: ['pol:c'],
    ...command(s.king, 'enact-law', third),
  });

  await assert.rejects(
    () =>
      s.legislature.resolve({
        lawId: second,
        reason: 'قصير',
        ...command(s.king, 'resolve-law-conflict', second),
      }),
    /LEGISLATION_RESOLUTION_INEFFECTIVE/,
  );
  await assert.rejects(
    () =>
      s.legislature.resolve({
        lawId: second,
        reason: 'لا تعارضَ قائمٌ الآن ومع ذلك يُطلب تعليقُ قانونٍ نافذ.',
        ...command(s.king, 'resolve-law-conflict', second),
      }),
    /LEGISLATION_RESOLUTION_INEFFECTIVE/,
  );

  // تعارضٌ قائمٌ فعلاً، لكنّ المُعلَّقَ قانونٌ لا يدخل فيه ⇒ حلٌّ لا يُزيل شيئاً.
  const widened = s.bundle.policies.map((entry) =>
    entry.id === 'pol:b' ? policyRecord({ ...entry, resources: ['task'] }) : entry,
  );
  s.legislature.bundle = bundleOf(widened);
  assert.notEqual((await s.legislature.blocked()).size, 0);
  await assert.rejects(
    () =>
      s.legislature.resolve({
        lawId: third,
        reason: 'تعليقُ قانونٍ لا يدخل في التعارض القائم بحجّة حلِّ التعارض.',
        ...command(s.king, 'resolve-law-conflict', third),
      }),
    /LEGISLATION_RESOLUTION_INEFFECTIVE/,
  );
});

test('دولةٌ بلا بوابةِ تاجٍ لا تُصدر قانوناً', async () => {
  const log = new EventLog();
  const laws = new LawRegistry({ log, repository: createMemoryRepository(LawRegistry.spec) });
  const legislature = new Legislature({
    policy: LEGISLATION_POLICY,
    bundle: bundleOf([policyRecord({ id: 'pol:a' })]),
    articles: ARTICLES,
    laws,
    log,
  });
  const id = await proposed(laws, 'قانونٌ بلا تاج');
  await assert.rejects(
    () =>
      legislature.enact({
        lawId: id,
        articleId: 'art:05',
        policyIds: ['pol:a'],
        command: createRoyalCommand('enact-law', id),
        signature: 'x',
      }),
    /LEGISLATION_ROYAL_COMMAND_REQUIRED/,
  );
  assert.throws(
    () =>
      new Legislature(
        /** @type {never} */ ({
          policy: LEGISLATION_POLICY,
          bundle: null,
          articles: [],
          laws,
          log,
        }),
      ),
    /LEGISLATURE_DEPENDENCY_MISSING/,
  );
});

test('صفٌّ نافذٌ بلا ربطٍ لا يُقرأ قانوناً ويُبلَّغ عنه', async () => {
  const s = state([policyRecord({ id: 'pol:a' })]);
  // كتابةٌ مباشرةٌ في المستودع تتجاوز `Legislature` — وهو ما يمنعه قيدُ الهجرة
  // 0011 في القاعدة الحقيقية؛ وفي الذاكرة يمنعه ثابتُ الكيان نفسُه.
  const id = await proposed(s.laws, 'قانونٌ بلا ربط');
  const row = await s.laws.repository.findById(id);
  assert.ok(row !== null);
  await assert.rejects(
    () =>
      s.laws.repository.update(id, Number(row['version']), {
        state: LawState.ENACTED,
        enactedBy: 'crown',
        enactedAt: new Date(),
      }),
    /LAW_ENACTED_REQUIRES_BINDING/,
  );
});

test('تركيبُ الحكم يُعلِن حاجزَ التشريع في ضماناته ويُنفِذه', async () => {
  const s = state([
    policyRecord({ id: 'pol:allow', effect: 'allow', priority: 70 }),
    policyRecord({ id: 'pol:deny', effect: 'deny', priority: 20 }),
  ]);
  const first = await proposed(s.laws, 'قانونُ التركيب');
  await s.legislature.enact({
    lawId: first,
    articleId: 'art:05',
    policyIds: ['pol:allow'],
    ...command(s.king, 'enact-law', first),
  });
  // قانونٌ ثانٍ لا يَنفُذ لتعارضه، فيبقى التعارضُ محسوباً على مرشَّحٍ لا نافذ؛
  // ولذلك يُقاس هنا الوعدُ نفسُه: التركيبُ يُعلِن أنّ الحاجزَ موصولٌ أو غيرُ موصول.
  // R5-A-02: المصنعُ الرسميُّ يُلزِمُ بوابةَ هويةٍ — لا يُبنى بلاها. وبوابةٌ
  // مصغَّرةٌ تُحاكي جذرَ الثقةِ تكفي لقياسِ الوعدِ هنا.
  const mockGate = {
    /** @param {string} actorId */
    async verify(actorId) {
      return {
        ok: true,
        code: 'IDENTITY_OK',
        reason: 'mock',
        actor: {
          id: actorId,
          role: 'role:operator',
          state: 'active',
          kind: /** @type {const} */ ('human'),
          capabilities: /** @type {readonly string[]} */ ([]),
        },
      };
    },
  };
  const bare = createGovernance({ log: s.log, bundle: s.bundle, identityGate: mockGate });
  assert.equal(bare.guarantees.legislationEnforced, false, 'من لم يمرّره لا يُوعَد به');
  const wired = createGovernance({
    log: s.log,
    bundle: s.bundle,
    identityGate: mockGate,
    legislationGate: enforcementGate(s.legislature),
  });
  assert.equal(wired.guarantees.legislationEnforced, true);
  assert.equal(wired.enforcement.legislationGate !== null, true, 'والوعدُ موصولٌ بالنقطة فعلاً');
});

// وصلُ السلطةِ بالتركيبِ الدائمِ (الفجوةُ الثالثةُ من الأمرِ التنفيذيِّ): كانت
// `Legislature` مبنيّةً ومُختبَرةً ولا مسارَ إنتاجيَّ لها — أي سلطةٌ تكشفُ التعارضَ
// ولا يقرأُها إنفاذٌ. وهذا الاختبارُ يقيسُ الوصلَ من `createRegistries` نفسِها:
// سلطةٌ مُعادةٌ، وحاجزٌ يُقرأُ، وبوابةُ تاجٍ نافذةٌ حين تُمرَّر، ورفضٌ مُسمَّى حين لا.
test('تركيبُ السجلاتِ يُخرِج سلطةً تشريعيّةً موصولةً دائماً بحاجزِها', async () => {
  const log = new EventLog();
  const registries = createRegistries({
    ca: /** @type {never} */ (new CertificateAuthority(new KingIdentity())),
    log: /** @type {never} */ (log),
    repositories: /** @type {never} */ (createMemoryRepositories()),
  });
  assert.ok(registries.legislature, 'السلطةُ التشريعيّةُ غيرُ مُركَّبةٍ في التركيبِ الرسميِّ');
  assert.equal(typeof registries.legislationGate.blockedActions, 'function');
  const blocked = await registries.legislationGate.blockedActions();
  assert.equal(blocked instanceof Set, true, 'الحاجزُ لا يُعيد مجموعةَ أفعالٍ ممنوعةٍ');
  // وبلا بوابةِ تاجٍ يُرفَض النفاذُ برمزِه لا بمقارنةِ اسمٍ: تركيبٌ صامتٌ كان سيجعل
  // إصدارَ قانونٍ ممكناً من أيِّ نداءٍ.
  const lawId = await proposed(registries.laws, 'قانونُ التركيبِ الدائمِ');
  await assert.rejects(
    () =>
      registries.legislature.enact({
        lawId,
        articleId: 'art:05',
        policyIds: ['pol:allow'],
        command: /** @type {never} */ ({}),
        signature: 'x',
      }),
    (/** @type {Error & { code?: string }} */ error) =>
      error.code === 'LEGISLATION_ROYAL_COMMAND_REQUIRED',
  );
});

test('تركيبُ السجلاتِ يمرّر بوابةَ التاجِ إلى السلطةِ فيَنفُذ القانونُ فعلاً', async () => {
  const log = new EventLog();
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const crown = new CrownGateway(king, ca, log);
  const registries = createRegistries({
    ca: /** @type {never} */ (ca),
    log: /** @type {never} */ (log),
    repositories: /** @type {never} */ (createMemoryRepositories()),
    crown: /** @type {never} */ (crown),
    legislationPolicy: /** @type {never} */ (LEGISLATION_POLICY),
    constitutionPolicy: /** @type {never} */ ({ articles: ARTICLES }),
    policyBundle: /** @type {never} */ (
      bundleOf([policyRecord({ id: 'pol:allow', effect: 'allow', priority: 70 })])
    ),
  });
  const lawId = await proposed(registries.laws, 'قانونٌ يَنفُذ من التركيبِ');
  const enactCommand = createRoyalCommand(LEGISLATION_POLICY.binding.enactAction, lawId);
  const { law } = await registries.legislature.enact({
    lawId,
    articleId: 'art:05',
    policyIds: ['pol:allow'],
    command: enactCommand,
    signature: king.sign(enactCommand),
  });
  assert.equal(law['state'], LawState.ENACTED);
});
