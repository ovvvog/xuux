/**
 * مَخرجُ مسارِ النشرِ القابلِ للتراجع — الخطوة `M10.06`.
 *
 * يُصدَّر من هنا ما يُنادى وما يُفحص: مُحمِّلُ عقدِ النشرِ، وبناءُ خطّةِ
 * الموجاتِ، والحكمُ عليها وآلةُ حالاتِها، وهويّةُ الإصداراتِ وهدفُ التراجعِ،
 * ورموزُ الرفضِ وصنفُ الخطأ. ولا يُصدَّر من هنا شيءٌ يلمس قرصاً: جمعُ الوقائعِ
 * وكتابةُ الدفترِ محصورانِ في `scripts/lib/deployment-facts.mjs` وحدَها.
 */

export { loadDeploymentContract, DEFAULT_DEPLOYMENT_CONFIG_DIR } from './contract.mjs';

export { buildRolloutPlan, waveById } from './plan.mjs';

export { judgeWave, nextStep, DEPLOY_VERDICTS } from './rollout.mjs';

export { assertReleaseId, selectRollbackTarget, requireRollbackTarget } from './releases.mjs';

export { DEPLOY_ERRORS, DeploymentError } from './errors.mjs';
