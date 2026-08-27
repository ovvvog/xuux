import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CertificateAuthority,
  CrownGateway,
  EventLog,
  KingIdentity,
} from '../../src/root-of-trust/index.mjs';
import { ConstitutionStore, loadConstitutionPolicy } from '../../src/constitution/constitution.mjs';
import {
  AmendmentPath,
  CONSTITUTION_EVENTS,
  ProposalState,
  ReviewVerdict,
} from '../../src/constitution/amendment-path.mjs';

// اختبارُ القبول للخطوة M8.01: **تعديلٌ دستوريٌّ خارج المسار يُرفض، وداخله يحتاج
// خطواتٍ متعدّدة**. والأوامرُ هنا **أوامرُ ملكيّةٌ حقيقيّةٌ مقبولةٌ من
// `CrownGateway`** لا كائناتٌ مصنوعة، كي يكون الاختبارُ على التكامل لا على وهمٍ.

const ARTICLE = 'art:03'; // جذر الثقة والمفاتيح — مادةٌ غيرُ مختومة
const ENTRENCHED = 'art:02'; // الدستورُ ومسارُ تعديله — مختومة
const NEW_TEXT =
  'مفتاحُ الملك أصلُ كلِّ تحقُّقٍ في الدولة، ويُحفظ في وحدةِ عتادٍ لا في ملفٍّ على قرص، وتدويرُه فعلٌ سياديٌّ يُعاد به توقيعُ كلِّ عهدٍ سابق.';
const REASON = 'حفظُ المفتاح في ملفٍّ صار أضعفَ حلقةٍ في جذر الثقة، ويلزم رفعُه إلى عتادٍ معزول.';
const OPINION = 'التعديلُ يشدّ المادةَ ولا يخالف مادةً مختومةً؛ فهو متوافقٌ مع النصّ.';

function setup() {
  const king = new KingIdentity();
  const ca = new CertificateAuthority(king);
  const log = new EventLog();
  const gateway = new CrownGateway(king, ca, log);
  const policy = loadConstitutionPolicy();
  let clock = new Date();
  const now = () => clock;
  const store = new ConstitutionStore({ policy, signer: king, now });
  const amendment = new AmendmentPath({ policy, store, log, now });

  /**
   * @param {string} action
   * @param {string} target
   * @param {object} [payload]
   */
  const issue = (action, target, payload = {}) => {
    const command = {
      id: `cmd:${randomUUID()}`,
      action,
      target,
      payload,
      issuedAt: new Date().toISOString(),
    };
    return gateway.command(command, king.sign(command));
  };

  return {
    king,
    log,
    policy,
    store,
    amendment,
    issue,
    crown: { id: king.id, roles: ['role:king'] },
    justice: { id: 'judge:chief', roles: ['role:chief-justice'] },
    minister: { id: 'minister:one', roles: ['role:minister'] },
    /** @param {number} seconds */
    advance(seconds) {
      clock = new Date(clock.getTime() + seconds * 1000);
    },
  };
}

/**
 * يمشي المسارَ كاملاً بخطواته الأربع.
 * @param {ReturnType<typeof setup>} env
 * @param {{ articleId?: string, text?: string }} [options]
 */
function walkFullPath(env, options = {}) {
  const articleId = options.articleId ?? ARTICLE;
  const text = options.text ?? NEW_TEXT;
  const proposal = env.amendment.propose({
    actor: env.crown,
    articleId,
    text,
    reason: REASON,
    command: env.issue('amend-constitution', articleId),
  });
  env.amendment.review({
    actor: env.justice,
    proposalId: proposal.id,
    verdict: ReviewVerdict.COMPATIBLE,
    opinion: OPINION,
  });
  env.advance(env.policy.amendment.deliberationSeconds);
  return env.amendment.ratify({
    actor: env.crown,
    proposalId: proposal.id,
    command: env.issue('ratify-constitution', articleId, { proposalHash: proposal.proposalHash }),
  });
}

test('المسارُ كاملاً يُبرم التعديل في عهدٍ جديدٍ مربوطٍ بسابقه', () => {
  const env = setup();
  assert.equal(env.store.epoch(), 1);
  const { proposal, revision } = walkFullPath(env);

  assert.equal(proposal.state, ProposalState.RATIFIED);
  assert.equal(revision.epoch, 2);
  assert.equal(revision.articleId, ARTICLE);
  assert.equal(revision.ratifiedBy, env.crown.id);
  assert.notEqual(revision.previousHash, 'genesis');
  // النصُّ النافذُ تغيّر، والمخزنُ ما زال متماسكاً.
  assert.equal(env.store.articleOf(ARTICLE).text, NEW_TEXT);
  env.store.assertIntact();

  // الخطواتُ الثلاثُ الفاعلةُ وقائعُ مسجَّلةٌ في قناة الدستور.
  const types = env.log.snapshot().map((entry) => entry.type);
  assert.ok(types.includes(CONSTITUTION_EVENTS.PROPOSED));
  assert.ok(types.includes(CONSTITUTION_EVENTS.REVIEWED));
  assert.ok(types.includes(CONSTITUTION_EVENTS.RATIFIED));
  assert.equal(env.log.verifyChain().ok, true);
});

test('الطرحُ يُرفض بلا أمرٍ ملكيّ، وبأمرٍ لفعلٍ آخر، وبأمرٍ لهدفٍ آخر', () => {
  const env = setup();
  const base = { actor: env.crown, articleId: ARTICLE, text: NEW_TEXT, reason: REASON };
  assert.throws(
    () => env.amendment.propose({ ...base, command: null }),
    /CONSTITUTION_COMMAND_REQUIRED/,
  );
  assert.throws(
    () => env.amendment.propose({ ...base, command: env.issue('change-policy', ARTICLE) }),
    /CONSTITUTION_COMMAND_REQUIRED/,
  );
  assert.throws(
    () => env.amendment.propose({ ...base, command: env.issue('amend-constitution', 'art:05') }),
    /CONSTITUTION_COMMAND_REQUIRED/,
  );
  // ولا شيءَ من ذلك خلّف طرحاً في المسار.
  assert.equal(env.amendment.proposals.size, 0);
  assert.equal(env.store.epoch(), 1);
});

test('المادةُ المختومةُ تُرفض داخل المسار نفسِه، ولو باستيفاء كلِّ شرطٍ آخر', () => {
  const env = setup();
  assert.throws(
    () =>
      env.amendment.propose({
        actor: env.crown,
        articleId: ENTRENCHED,
        text: NEW_TEXT,
        reason: REASON,
        command: env.issue('amend-constitution', ENTRENCHED),
      }),
    /CONSTITUTION_ARTICLE_ENTRENCHED/,
  );
  assert.equal(env.store.epoch(), 1);
});

test('الطرحُ يُرفض بنصٍّ غيرِ متغيّرٍ، وبسببٍ ناقص، وبدورٍ غيرِ الملك', () => {
  const env = setup();
  const current = env.store.articleOf(ARTICLE).text;
  assert.throws(
    () =>
      env.amendment.propose({
        actor: env.crown,
        articleId: ARTICLE,
        text: current,
        reason: REASON,
        command: env.issue('amend-constitution', ARTICLE),
      }),
    /CONSTITUTION_TEXT_UNCHANGED/,
  );
  assert.throws(
    () =>
      env.amendment.propose({
        actor: env.crown,
        articleId: ARTICLE,
        text: NEW_TEXT,
        reason: 'لأني أريد',
        command: env.issue('amend-constitution', ARTICLE),
      }),
    /CONSTITUTION_REASON_MISSING/,
  );
  assert.throws(
    () =>
      env.amendment.propose({
        actor: env.minister,
        articleId: ARTICLE,
        text: NEW_TEXT,
        reason: REASON,
        command: env.issue('amend-constitution', ARTICLE),
      }),
    /CONSTITUTION_ROLE_REFUSED/,
  );
});

test('المراجعةُ: لا يراجعها الطارحُ ولا غيرُ القضاء، ولا تُقبل بلا رأيٍ أو بحكمٍ مجهول', () => {
  const env = setup();
  const proposal = env.amendment.propose({
    actor: env.crown,
    articleId: ARTICLE,
    text: NEW_TEXT,
    reason: REASON,
    command: env.issue('amend-constitution', ARTICLE),
  });
  assert.throws(
    () =>
      env.amendment.review({
        actor: env.minister,
        proposalId: proposal.id,
        verdict: ReviewVerdict.COMPATIBLE,
        opinion: OPINION,
      }),
    /CONSTITUTION_ROLE_REFUSED/,
  );
  // الطارحُ نفسُه بدور رئيس القضاة: الدورُ مستوفًى والفاعلُ هو هو ⇒ رفض.
  assert.throws(
    () =>
      env.amendment.review({
        actor: { id: env.crown.id, roles: ['role:chief-justice'] },
        proposalId: proposal.id,
        verdict: ReviewVerdict.COMPATIBLE,
        opinion: OPINION,
      }),
    /CONSTITUTION_SELF_REVIEW_REFUSED/,
  );
  assert.throws(
    () =>
      env.amendment.review({
        actor: env.justice,
        proposalId: proposal.id,
        verdict: 'ok',
        opinion: OPINION,
      }),
    /CONSTITUTION_REVIEW_VERDICT_INVALID/,
  );
  assert.throws(
    () =>
      env.amendment.review({
        actor: env.justice,
        proposalId: proposal.id,
        verdict: ReviewVerdict.COMPATIBLE,
        opinion: 'لا مانع',
      }),
    /CONSTITUTION_OPINION_MISSING/,
  );
});

test('الإبرامُ يُرفض بلا مراجعة، وبعد حكمِ تعارض، وقبل انقضاء مهلة التدبُّر', () => {
  const env = setup();
  const proposal = env.amendment.propose({
    actor: env.crown,
    articleId: ARTICLE,
    text: NEW_TEXT,
    reason: REASON,
    command: env.issue('amend-constitution', ARTICLE),
  });
  const ratifyArgs = () => ({
    actor: env.crown,
    proposalId: proposal.id,
    command: env.issue('ratify-constitution', ARTICLE, { proposalHash: proposal.proposalHash }),
  });
  assert.throws(() => env.amendment.ratify(ratifyArgs()), /CONSTITUTION_REVIEW_MISSING/);

  // مهلةُ التدبُّر مقيسةٌ لا مفترضة.
  env.amendment.review({
    actor: env.justice,
    proposalId: proposal.id,
    verdict: ReviewVerdict.COMPATIBLE,
    opinion: OPINION,
  });
  assert.equal(
    Math.round(env.amendment.deliberationRemaining(proposal.id)),
    env.policy.amendment.deliberationSeconds,
  );
  assert.throws(() => env.amendment.ratify(ratifyArgs()), /CONSTITUTION_DELIBERATION_INCOMPLETE/);
  env.advance(env.policy.amendment.deliberationSeconds - 1);
  assert.throws(() => env.amendment.ratify(ratifyArgs()), /CONSTITUTION_DELIBERATION_INCOMPLETE/);
  assert.equal(env.store.epoch(), 1);

  // وحكمُ التعارض يُنهي الطرحَ ولا ينتظر انقضاءَ المهلة.
  const other = setup();
  const conflicted = other.amendment.propose({
    actor: other.crown,
    articleId: ARTICLE,
    text: NEW_TEXT,
    reason: REASON,
    command: other.issue('amend-constitution', ARTICLE),
  });
  other.amendment.review({
    actor: other.justice,
    proposalId: conflicted.id,
    verdict: ReviewVerdict.CONFLICT,
    opinion: 'التعديلُ يخالف المادةَ المختومةَ في السيادة، فهو متعارضٌ معها.',
  });
  other.advance(other.policy.amendment.deliberationSeconds);
  assert.throws(
    () =>
      other.amendment.ratify({
        actor: other.crown,
        proposalId: conflicted.id,
        command: other.issue('ratify-constitution', ARTICLE, {
          proposalHash: conflicted.proposalHash,
        }),
      }),
    /CONSTITUTION_REVIEW_CONFLICT/,
  );
});

test('الإبرامُ يلزمه أمرٌ ثانٍ يحمل تجزئةَ الطرح، ولا يُقبل أمرٌ استُهلك', () => {
  const env = setup();
  const proposal = env.amendment.propose({
    actor: env.crown,
    articleId: ARTICLE,
    text: NEW_TEXT,
    reason: REASON,
    command: env.issue('amend-constitution', ARTICLE),
  });
  env.amendment.review({
    actor: env.justice,
    proposalId: proposal.id,
    verdict: ReviewVerdict.COMPATIBLE,
    opinion: OPINION,
  });
  env.advance(env.policy.amendment.deliberationSeconds);

  // أمرٌ صحيحُ الفعلِ والهدفِ لكنه بلا تجزئةِ الطرح ⇒ رفض.
  assert.throws(
    () =>
      env.amendment.ratify({
        actor: env.crown,
        proposalId: proposal.id,
        command: env.issue('ratify-constitution', ARTICLE),
      }),
    /CONSTITUTION_PROPOSAL_HASH_MISMATCH/,
  );
  // وأمرٌ بتجزئةٍ لطرحٍ آخر ⇒ رفض.
  assert.throws(
    () =>
      env.amendment.ratify({
        actor: env.crown,
        proposalId: proposal.id,
        command: env.issue('ratify-constitution', ARTICLE, { proposalHash: 'ما ليس تجزئةَ الطرح' }),
      }),
    /CONSTITUTION_PROPOSAL_HASH_MISMATCH/,
  );

  const command = env.issue('ratify-constitution', ARTICLE, {
    proposalHash: proposal.proposalHash,
  });
  const { revision } = env.amendment.ratify({
    actor: env.crown,
    proposalId: proposal.id,
    command,
  });
  assert.equal(revision.epoch, 2);

  // طرحٌ ثانٍ مستوفٍ لكلِّ شيءٍ، ثم **إعادةُ استعمال أمرِ الإبرام الأول** ⇒ رفض.
  const second = env.amendment.propose({
    actor: env.crown,
    articleId: ARTICLE,
    text: `${NEW_TEXT} ويُنشر أثرُ كلِّ تدويرٍ في سجلٍّ عامّ.`,
    reason: REASON,
    command: env.issue('amend-constitution', ARTICLE),
  });
  env.amendment.review({
    actor: env.justice,
    proposalId: second.id,
    verdict: ReviewVerdict.COMPATIBLE,
    opinion: OPINION,
  });
  env.advance(env.policy.amendment.deliberationSeconds);
  assert.throws(
    () =>
      env.amendment.ratify({
        actor: env.crown,
        proposalId: second.id,
        command: { ...command, payload: { proposalHash: second.proposalHash } },
      }),
    /CONSTITUTION_COMMAND_REPLAYED/,
  );
  assert.equal(env.store.epoch(), 2);
});

test('طرحٌ بُني على عهدٍ زال لا يُبرَم، ويُعاد طرحُه على النصّ القائم', () => {
  const env = setup();
  const stale = env.amendment.propose({
    actor: env.crown,
    articleId: ARTICLE,
    text: NEW_TEXT,
    reason: REASON,
    command: env.issue('amend-constitution', ARTICLE),
  });
  env.amendment.review({
    actor: env.justice,
    proposalId: stale.id,
    verdict: ReviewVerdict.COMPATIBLE,
    opinion: OPINION,
  });

  // تعديلٌ آخرُ يُبرَم أوّلاً على مادةٍ أخرى ⇒ يرتفع العهد.
  walkFullPath(env, {
    articleId: 'art:05',
    text: 'لا يَنفُذ قانونٌ إلا باعتمادٍ من التاج ونشرِه في سجلٍّ عامٍّ قبل نفاذه بمهلةٍ مُعلَنة.',
  });
  assert.equal(env.store.epoch(), 2);

  env.advance(env.policy.amendment.deliberationSeconds);
  assert.throws(
    () =>
      env.amendment.ratify({
        actor: env.crown,
        proposalId: stale.id,
        command: env.issue('ratify-constitution', ARTICLE, { proposalHash: stale.proposalHash }),
      }),
    /CONSTITUTION_PROPOSAL_STALE/,
  );
  assert.equal(env.store.epoch(), 2);
});

test('كلُّ رفضٍ واقعةٌ مسجَّلةٌ برمزها؛ فلا منعَ صامتاً في هذا المسار', () => {
  const env = setup();
  assert.throws(
    () =>
      env.amendment.propose({
        actor: env.crown,
        articleId: ENTRENCHED,
        text: NEW_TEXT,
        reason: REASON,
        command: null,
      }),
    /CONSTITUTION_ARTICLE_ENTRENCHED/,
  );
  const refusals = env.log.snapshot().filter((entry) => entry.type === CONSTITUTION_EVENTS.REFUSED);
  assert.equal(refusals.length, 1);
  const first = refusals[0];
  assert.ok(first !== undefined);
  assert.equal(
    /** @type {Record<string, unknown>} */ (first.data).code,
    'CONSTITUTION_ARTICLE_ENTRENCHED',
  );
});
