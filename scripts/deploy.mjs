#!/usr/bin/env node
/**
 * منفِّذُ النشرِ القابلِ للتراجع — الخطوة `M10.06`.
 *
 * **معيارُ القبولِ بحرفِه:** «اختبار: نشر إصدار معيوب ⇒ تراجع تلقائي بلا
 * تدخل». فهذا المنفِّذُ **يتراجع من تلقائِه**: لا علمَ يُمرَّر لتعطيلِ التراجعِ،
 * ولا سؤالَ يُطرَح على مُشغِّلٍ، ولا انتظارَ إقرارٍ — الضمانُ
 * `G-DEPLOY-ROLLBACK-AUTOMATIC` منفَّذٌ في هذا الملفِّ بعينِه: أوّلُ حكمٍ من
 * `rollback.triggerOn` يُعيد آخرَ إصدارٍ نُشِّط بحكمٍ صحيحٍ **من دفترِ النشرِ**
 * ويكتب مدّةَ تراجعِه مقيسةً.
 *
 * والاستعمال:
 *
 * ```
 * node scripts/deploy.mjs --release 1.2.3 --source <مجلَّد> [--root .] [--dry-run] [--json]
 * ```
 *
 * و`--dry-run` يقرأ العقدَ ويبني الخطّةَ ويُعلن الموجاتِ وبواباتِها **ولا
 * يُهيِّئ إصداراً ولا يُنشِّط شيئاً ولا يكتب سطراً في دفتر**.
 *
 * **حدٌّ معلَن:** «النصيب» في هذا المنفِّذِ **رقمٌ مُعلَنٌ يُكتب في المؤشِّرِ
 * ويُمرَّر إلى المجسّ**، لا موزِّعُ حِملٍ يُغيّر مسار النداءات: توجيهُ الحِمل
 * يلزمه صادرٌ خارجيٌّ (موزِّعٌ أو بوّابةٌ) خارج حجزِ هذه الخطوة، وهو مسجَّلٌ
 * ديناً معلَناً في `docs/REMAINING_WORK.md` لا سهواً يُكتشَف.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildRolloutPlan,
  judgeWave,
  loadDeploymentContract,
  nextStep,
  requireRollbackTarget,
  assertReleaseId,
  DEPLOY_ERRORS,
  DeploymentError,
} from '../src/deployment/index.mjs';
import {
  appendLedger,
  probeWave,
  readLedger,
  stageRelease,
  writePointer,
} from './lib/deployment-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * @param {string[]} argv
 * @returns {{ release: string | null, source: string | null, root: string, dryRun: boolean, json: boolean }}
 */
function parseArguments(argv) {
  /** @type {{ release: string | null, source: string | null, root: string, dryRun: boolean, json: boolean }} */
  const options = { release: null, source: null, root: ROOT, dryRun: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--release') options.release = argv[(index += 1)] ?? null;
    else if (flag === '--source') options.source = argv[(index += 1)] ?? null;
    else if (flag === '--root') options.root = path.resolve(argv[(index += 1)] ?? ROOT);
  }
  return options;
}

/**
 * @param {import('../src/deployment/contract.mjs').DeploymentContract} contract
 * @param {string} verdictId
 * @returns {number}
 */
function exitCodeOf(contract, verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  if (verdict === undefined) {
    throw new DeploymentError(
      DEPLOY_ERRORS.VERDICT_UNDECLARED,
      `الحكم «${verdictId}» بلا رمزِ خروجٍ في العقد — والمسارُ الآليُّ يقرأ الرمزَ لا النصّ.`,
      { verdict: verdictId },
    );
  }
  return verdict.exitCode;
}

const options = parseArguments(process.argv.slice(2));
const now = () => Date.now();
const contract = loadDeploymentContract();
const plan = buildRolloutPlan(contract);

/** @type {Record<string, unknown>} */
const report = {
  release: options.release,
  dryRun: options.dryRun,
  waves: [],
  rollback: null,
  verdict: null,
};

if (options.dryRun) {
  report.verdict = 'verdict:healthy';
  report.waves = plan.map((wave) => ({
    wave: wave.id,
    sharePercent: wave.sharePercent,
    minObservations: wave.minObservations,
    objectives: wave.objectives.map((id) => ({
      id,
      target: contract.objectives[id]?.target ?? null,
    })),
  }));
  emit(report, 0);
}

if (options.release === null || options.source === null) {
  console.error(
    '⛔ نشرٌ بلا هويّةِ إصدارٍ أو بلا مصدرٍ: node scripts/deploy.mjs --release <هويّة> --source <مجلَّد>',
  );
  process.exit(64);
}

assertReleaseId(options.release, contract.release.idPattern);

/** @type {string} */
const releaseId = options.release;
const staged = stageRelease({
  contract,
  root: options.root,
  releaseId,
  source: path.resolve(options.source),
  at: now(),
});
appendLedger({
  contract,
  root: options.root,
  entry: { type: 'deploy.release.staged', release: releaseId, digest: staged.digest },
  at: now(),
});

for (const wave of plan) {
  writePointer({
    contract,
    root: options.root,
    release: releaseId,
    wave: wave.id,
    sharePercent: wave.sharePercent,
    at: now(),
  });

  /** @type {import('../src/deployment/rollout.mjs').WaveJudgement} */
  let judgement;
  try {
    const observation = probeWave({ contract, releaseDir: staged.dir, wave });
    judgement = judgeWave({ wave, objectives: contract.objectives, observation });
  } catch (error) {
    // ومجسٌّ لا يُصدر مشاهداتٍ **عطبٌ لا صمت**: فمن عدّه صمتاً قدَّم الموجةَ
    // التاليةَ على إصدارٍ لا يعمل أصلاً.
    judgement = Object.freeze({
      wave: wave.id,
      verdict: 'verdict:broken',
      objectives: Object.freeze([]),
      reason: `مجسُّ الموجةِ «${wave.id}» أخفق: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const step = nextStep({ wave, judgement, rollback: contract.rollback });
  /** @type {Record<string, unknown>[]} */
  const waves = /** @type {Record<string, unknown>[]} */ (report.waves);
  waves.push({
    wave: wave.id,
    sharePercent: wave.sharePercent,
    verdict: judgement.verdict,
    reason: judgement.reason,
    objectives: judgement.objectives,
    action: step.action,
  });

  if (step.action === 'rollback') {
    appendLedger({
      contract,
      root: options.root,
      entry: {
        type: 'deploy.wave.refused',
        release: releaseId,
        wave: wave.id,
        verdict: judgement.verdict,
        reason: judgement.reason,
      },
      at: now(),
    });
    const startedAt = now();
    const target = requireRollbackTarget(readLedger(contract, options.root), {
      excludeRelease: releaseId,
    });
    writePointer({
      contract,
      root: options.root,
      release: target,
      wave: wave.id,
      sharePercent: 100,
      at: now(),
    });
    const durationMs = now() - startedAt;
    appendLedger({
      contract,
      root: options.root,
      entry: {
        type: 'deploy.rollback.performed',
        release: target,
        from: releaseId,
        wave: wave.id,
        verdict: judgement.verdict,
        durationMs,
        withinLimit: durationMs <= contract.rollback.maxDurationMs,
        automatic: true,
      },
      at: now(),
    });
    report.rollback = { to: target, from: releaseId, durationMs, automatic: true };
    report.verdict = judgement.verdict;
    emit(report, exitCodeOf(contract, judgement.verdict));
  }

  appendLedger({
    contract,
    root: options.root,
    entry: {
      type: step.action === 'activate' ? 'deploy.release.activated' : 'deploy.wave.promoted',
      release: releaseId,
      wave: wave.id,
      verdict: judgement.verdict,
    },
    at: now(),
  });
}

report.verdict = 'verdict:healthy';
emit(report, 0);

/**
 * إصدارُ التقريرِ ثم الخروجُ برمزِ الحكمِ — والمسارُ الآليُّ يقرأ الرمزَ.
 *
 * @param {Record<string, unknown>} payload
 * @param {number} code
 * @returns {never}
 */
function emit(payload, code) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('═══ النشر القابل للتراجع ═══');
    console.log(`   الإصدار: ${String(payload.release)}`);
    for (const wave of /** @type {Record<string, unknown>[]} */ (payload.waves)) {
      console.log(
        `   • ${String(wave.wave)} (${String(wave.sharePercent)}٪): ${String(wave.verdict ?? 'verdict:healthy')} — ${String(wave.reason ?? 'خطّةٌ مُعلَنةٌ بلا تنفيذٍ (--dry-run)')}`,
      );
    }
    if (payload.rollback !== null) {
      const rollback = /** @type {Record<string, unknown>} */ (payload.rollback);
      console.log(
        `⛔ تراجعٌ آليٌّ بلا تدخّل: أُعيد «${String(rollback.to)}» بدل «${String(rollback.from)}» في ${String(rollback.durationMs)} ملّي ثانية.`,
      );
    } else {
      console.log(
        `✅ النشر تمّ: ${String(payload.release)} على الحِمل كلِّه بعد اجتياز ${String(/** @type {unknown[]} */ (payload.waves).length)} موجاتٍ بواباتُها من أهداف الخدمة نفسِها، والتراجع مسلَّحٌ آلياً لا موقوفٌ على إقرار.`,
      );
    }
  }
  process.exit(code);
}
