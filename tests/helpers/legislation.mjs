// معِين اختبارات التشريع — أُضيف في `WL-045`.
//
// **العيب الذي يُغلقه:** النفاذُ لم يبقَ انتقالَ حالةٍ منذ `M8.02`: القانونُ
// النافذُ مربوطٌ بمادةٍ دستوريةٍ وبسياسةٍ تُنفِّذه، والربطُ يقع بأمرٍ ملكيٍّ
// موقَّعٍ عبر `Legislature.enact` أو لا يقع. واختباراتٌ سابقةٌ لتلك الخطوة كانت
// تُنفِّذ القانونَ بـ`laws.transition(id, ENACTED, 'crown')` — مقارنةَ نصٍّ لا
// سلطةً — فصارت تُخفق بـ`LAW_ENACTMENT_PATH_REQUIRED` عند تشغيلها على قاعدةٍ
// حقيقية. ولم يظهر ذلك لأن اختبارات القاعدة كانت متخطّاةً دائماً بغياب
// `DATABASE_URL`، ومسارُ CI كان يموت في خطوة الهجرات قبل الوصول إليها.
//
// **قرارٌ مقصود:** المعِينُ يمرّ بالمسار الحقيقي كاملاً — تاجٌ حقيقيٌّ بمفتاحٍ
// وشهادةٍ، وأمرٌ ملكيٌّ موقَّعٌ، وكشفُ تعارضٍ قبل النفاذ — ولا يكتب في العمودين
// مباشرةً. كتابةُ الربط بيدِ الاختبار كانت ستُنتج «قانوناً نافذاً» لم يمرّ بسلطةٍ،
// أي تُخضِّر القياسَ بتجاوز ما جاءت الخطوةُ لإقامته.
//
// **حدٌّ معلَن:** الموادُّ والسياساتُ هنا مجموعةٌ صغيرةٌ كافيةٌ للربط، وليست
// الدستورَ ولا حزمةَ السياسات المحمَّلة من `config/`. فما يقيسه هذا المعِين هو
// أن النفاذَ يمرّ بسلطةٍ موقَّعة، لا صحّةُ مادةٍ بعينها في الدستور.

import path from 'node:path';

import {
  CertificateAuthority,
  CrownGateway,
  KingIdentity,
  createRoyalCommand,
} from '../../src/root-of-trust/index.mjs';
import { LawState } from '../../src/governance/index.mjs';
import { Legislature, loadLegislationPolicy } from '../../src/legislation/index.mjs';

const LEGISLATION_POLICY = loadLegislationPolicy({ dir: path.join(process.cwd(), 'config') });

/** نصٌّ يبلغ الحدَّ الأدنى المُعلَن في `config/legislation.yaml` (`minTextLength`). */
export const BINDABLE_TEXT = `ما لا يبقى بعد إعادة التشغيل لا يُحكم به. ${'ن'.repeat(200)}`;

/** المادةُ الساندةُ المستعملة في هذه الاختبارات. */
export const HELPER_ARTICLE_ID = 'art:07';

/** معرّفُ السياسةِ المُنفِّذة المستعمل في هذه الاختبارات. */
export const HELPER_POLICY_ID = 'pol:restart-baseline';

const ARTICLES = Object.freeze([Object.freeze({ id: HELPER_ARTICLE_ID, lawRef: 'law:audit' })]);

/**
 * حزمةُ سياساتٍ مصغَّرةٌ فيها سياسةٌ واحدةٌ مفعَّلةٌ مرجعُها قانونُ الاختبار.
 * @param {string} lawRef
 * @returns {import('../../src/policy/loader.mjs').PolicyBundle}
 */
function bundleFor(lawRef) {
  return /** @type {import('../../src/policy/loader.mjs').PolicyBundle} */ (
    /** @type {unknown} */ ({
      actions: new Map([
        [
          'run-task',
          { id: 'run-task', sensitive: false, resource: 'task', description: 'فعلُ اختبار' },
        ],
      ]),
      policies: [
        Object.freeze({
          id: HELPER_POLICY_ID,
          name: HELPER_POLICY_ID,
          owner: 'role:king',
          version: 1,
          effect: 'allow',
          priority: 50,
          reason: 'سياسةُ إنفاذٍ لقانونِ الاختبار',
          enabled: true,
          lawRef,
          actors: { roles: ['role:operator'] },
          actions: ['run-task'],
          resources: ['task'],
        }),
      ],
      roles: new Map([['role:operator', { id: 'role:operator', capabilities: [] }]]),
      threshold: [],
      quotas: [],
      versions: { policies: 1, roles: 1, royalAuthority: 1, quotas: 1 },
    })
  );
}

/**
 * يُنفِّذ قانوناً قائماً بالمسار الحقيقي: ربطٌ بمادةٍ وسياسةٍ، وأمرٌ ملكيٌّ موقَّع.
 *
 * القانونُ يجب أن يكون في حالة `proposed` وأن يبلغ نصُّه `minTextLength`.
 * @param {object} input
 * @param {import('../../src/governance/index.mjs').LawRegistry} input.laws
 * @param {import('../../src/root-of-trust/event-log.mjs').EventLog} input.log
 * @param {string} input.lawId
 * @param {string} [input.lawRef] مرجعُ القانون في السياسة المُنفِّذة؛ افتراضُه `law:audit`.
 * @returns {Promise<Record<string, unknown>>} صفُّ القانون بعد النفاذ
 */
export async function enactLawThroughCrown({ laws, log, lawId, lawRef = 'law:audit' }) {
  const king = new KingIdentity();
  const crown = new CrownGateway(king, new CertificateAuthority(king), log);
  const legislature = new Legislature({
    policy: LEGISLATION_POLICY,
    bundle: bundleFor(lawRef),
    articles: ARTICLES,
    laws,
    log,
    crown,
  });
  const command = createRoyalCommand(LEGISLATION_POLICY.binding.enactAction, lawId);
  const { law } = await legislature.enact({
    lawId,
    articleId: HELPER_ARTICLE_ID,
    policyIds: [HELPER_POLICY_ID],
    command,
    signature: king.sign(command),
  });
  return law;
}

/** الحالةُ التي يجب أن يكون عليها القانونُ قبل النفاذ. */
export const REQUIRED_STATE_BEFORE_ENACT = LawState.PROPOSED;
