#!/usr/bin/env node
/**
 * إقامةُ البيئةِ بأمرٍ واحد — `npm run bootstrap` (الخطوة `M10.05`).
 *
 * **هذا السكربتُ يستبدل القالبَ `scripts/bootstrap.sh`** الذي كان ثلاثةَ
 * تعليقاتٍ لا تُنشئ شيئاً (تدقيقُ خطِّ الأساس §2.4). والفرقُ ليس في اللغةِ بل
 * في أنّ هذا **يقرأ عقداً مُعلَناً** في `config/environment.yaml` ويُنفِّذ
 * أطوارَه بترتيبِها ويُقيّد كلَّ طورٍ ويُنهي **بحكمِ فحصِ صحّةٍ** — فمن نزل
 * بمستودعٍ نظيفٍ لم يحتج إلى من يُخبره بالترتيب.
 *
 * **والقرارُ منفصلٌ عن الأثر:** الخطّةُ تُحسَب في `src/environment/plan.mjs`
 * النقيّةِ من وقائعَ يجمعها `scripts/lib/environment-facts.mjs`، وهذا الملفُّ
 * **مُنفِّذٌ لا مُقرِّرٌ**: لا شرطَ تخطٍّ مكتوبٌ فيه، ولا أمرَ طورٍ، ولا مهلةَ —
 * كلُّها من الوثيقة. ويقيس الحاجزُ (R5) غيابَ أسماءِ الأوامرِ نصّاً من هنا.
 *
 * الأعلام:
 *   `--dry-run`      يحسب الخطّةَ ويُقيّدها ولا يُنفِّذ طوراً — للاختبارِ وللمراجعة.
 *   `--json`         مخرَجٌ آليٌّ للقراءةِ في اختبارِ القبولِ وفي مسارٍ آليّ.
 *   `--profile=<id>` وضعٌ صريحٌ من `profiles` المُعلَنة (وإلا استُنبِط من البيئة).
 *   `--dir=<path>`   مجلَّدُ الوثائقِ (للاختبارِ على عقدٍ مُصطنَع).
 *   `--ledger=<path>` ملفُّ سجلِّ الأثر.
 *
 * **رمزُ الخروجِ:** طورٌ فاشلٌ ⇒ `1` (فإقامةٌ ناقصةٌ تخرج صفراً إقامةٌ يُبنى
 * عليها)، وإلا فرمزُ حكمِ فحصِ الصحّةِ **من الوثيقةِ** لا من هذا الملف.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { Environment } from '../src/environment/index.mjs';
import { collectFacts, collectObservations, detectProfile } from './lib/environment-facts.mjs';
import { EnvironmentLedger } from './lib/environment-ledger.mjs';

/** @param {string} name @returns {string | null} */
function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

const dryRun = process.argv.includes('--dry-run');
const asJson = process.argv.includes('--json');
const configDir = flag('dir');
const ledgerPath =
  flag('ledger') ?? path.join(process.cwd(), '.state', 'logs', 'environment.jsonl');
// المُقيمُ يُنشئ مجلَّدَ السجلِّ لأنّ إنشاءَ المجلَّداتِ **طورٌ من عملِه
// المُعلَن**؛ أمّا التشغيلُ الجافُّ **فلا يُحدِث أثراً على القرصِ أصلاً** ولو
// كان أثرَ قيدٍ: فمن قال «جافٌّ» ثم أنشأ مجلَّداً قال ما لم يفعل، وعندها
// يُعلَن القيدُ مُسقَطاً ولا يُسكَت.
const ledger = new EnvironmentLedger(ledgerPath, { createDir: !dryRun });

/** @type {Environment} */
let environment;
try {
  environment = new Environment({
    ...(configDir === null ? {} : { dir: configDir }),
    log: ledger,
  });
} catch (error) {
  const code = /** @type {{ code?: string }} */ (error).code ?? 'ENV_CONFIG_INVALID';
  const message = error instanceof Error ? error.message : String(error);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  } else {
    console.error(`⛔ عقدُ البيئةِ مرفوضٌ [${code}]: ${message}`);
  }
  process.exit(1);
}

const contract = environment.contract;
const profileFlag = flag('profile');
const facts = collectFacts(contract);
const profile = profileFlag ?? facts.profile;
const plan = environment.plan({ ...facts, profile }, { actor: 'system@bootstrap' });

if (!asJson) {
  console.log('┌─ إقامةُ البيئةِ بأمرٍ واحد — الخطوة M10.05');
  console.log(
    `│ الوضعُ المقروءُ: ${profile}${profileFlag === null ? ' (مستنبَطٌ من البيئة)' : ' (صريحٌ بعَلَم)'}`,
  );
  console.log(
    `│ الأطوارُ: ${String(plan.executeCount)} تُنفَّذ و${String(plan.skipCount)} تُتخطّى بسببٍ مُسمّى`,
  );
  console.log(`│ سجلُّ الأثر: ${ledger.file}`);
  console.log('└─');
}

/** @type {{ phase: string, title: string, status: string, exitCode: number | null, durationMs: number, detail: string }[]} */
const outcomes = [];
let failedPhase = null;

for (const step of plan.steps) {
  if (step.skipped) {
    outcomes.push({
      phase: step.phase,
      title: step.title,
      status: 'skipped',
      exitCode: null,
      durationMs: 0,
      detail: step.skipStatement ?? '',
    });
    environment.recordPhase(
      {
        phase: step.phase,
        ok: true,
        exitCode: null,
        durationMs: 0,
        detail: `مُتخطّىً: ${step.skipReason ?? 'غيرُ مُسمّى'}`,
      },
      { actor: 'system@bootstrap' },
    );
    if (!asJson) console.log(`  ⏭  ${step.title} — ${step.skipStatement ?? ''}`);
    continue;
  }
  if (dryRun) {
    outcomes.push({
      phase: step.phase,
      title: step.title,
      status: 'planned',
      exitCode: null,
      durationMs: 0,
      detail: 'تشغيلٌ جافٌّ: الخطّةُ محسوبةٌ ولا أثرَ يقع.',
    });
    if (!asJson) console.log(`  ○  ${step.title} — تشغيلٌ جافٌّ، لا أثرَ يقع.`);
    continue;
  }

  const startedAt = Date.now();
  /** @type {number | null} */
  let exitCode;
  /** @type {string} */
  let detail;
  if (step.kind === 'directories') {
    try {
      for (const directory of plan.directories) {
        fs.mkdirSync(path.resolve(process.cwd(), directory), { recursive: true });
      }
      exitCode = 0;
      detail = `${String(plan.directories.length)} مجلَّداتٍ مُعلَنةً حاضرةً`;
    } catch (error) {
      exitCode = 1;
      detail = error instanceof Error ? error.message : String(error);
    }
  } else if (step.command === null) {
    exitCode = 1;
    detail = 'طورُ أمرٍ بلا أمرٍ مُعلَنٍ في الوثيقة.';
  } else {
    const outcome = spawnSync(step.command, step.args, {
      stdio: asJson ? 'pipe' : 'inherit',
      timeout: step.timeoutMs,
      shell: false,
      encoding: 'utf8',
    });
    if (outcome.error !== undefined) {
      exitCode = 1;
      detail = outcome.error.message;
    } else {
      exitCode = outcome.status ?? 1;
      detail = exitCode === 0 ? 'نُفِّذ' : `رمزُ خروجٍ ${String(exitCode)}`;
    }
  }
  const durationMs = Date.now() - startedAt;
  const ok = exitCode === 0;
  outcomes.push({
    phase: step.phase,
    title: step.title,
    status: ok ? 'ok' : 'failed',
    exitCode,
    durationMs,
    detail,
  });
  environment.recordPhase(
    { phase: step.phase, ok, exitCode, durationMs, detail },
    { actor: 'system@bootstrap' },
  );
  if (!asJson)
    console.log(`  ${ok ? '✅' : '⛔'} ${step.title} — ${detail} (${String(durationMs)}ms)`);
  if (!ok) {
    failedPhase = step.phase;
    break;
  }
}

if (failedPhase !== null) {
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, profile, failedPhase, phases: outcomes })}\n`,
    );
  } else {
    console.error(
      `⛔ الإقامةُ توقّفت عند الطورِ «${failedPhase}»؛ وإقامةٌ ناقصةٌ تخرج صفراً إقامةٌ يُبنى عليها. أصلح السببَ ثم أعد الأمرَ نفسَه — كلُّ طورٍ متكافئٌ.`,
    );
  }
  process.exit(1);
}

// **الإقامةُ لا تُصدِّق نفسَها**: تُنهي بفحصِ صحّةٍ يقرأ وقائعَ البيئةِ بعد
// الأطوارِ ويُصدر حكماً — فمعيارُ القبولِ «بيئةٌ نظيفةٌ ⇒ نظامٌ عاملٌ بأمرٍ
// واحدٍ ⇒ فحصُ صحّةٍ ناجح» ثلاثةُ أجزاءٍ ثالثُها ليس اختياريّاً.
const report = environment.verify(collectObservations(contract), { actor: 'system@bootstrap' });

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      profile,
      dryRun,
      detectedProfile: detectProfile(),
      auditWritten: ledger.count,
      auditDropped: ledger.dropped,
      phases: outcomes,
      verdict: report.verdict,
      exitCode: report.exitCode,
      probes: report.results.map((result) => ({
        probe: result.probe,
        severity: result.severity,
        satisfied: result.satisfied,
      })),
    })}\n`,
  );
} else {
  console.log('┌─ فحصُ الصحّةِ بعد الإقامة');
  for (const result of report.results) {
    console.log(
      `│ ${result.satisfied ? '✅' : result.severity === 'critical' ? '⛔' : '⚠️ '} ${result.probe} [${result.severity}] — ${result.detail}`,
    );
  }
  if (ledger.dropped > 0) {
    console.log(
      `│ قيدُ الأثرِ مُسقَطٌ (${String(ledger.dropped)}): تشغيلٌ جافٌّ لا يُنشئ مجلَّدَ سجلٍّ — فالإسقاطُ يُقال ولا يُسكَت.`,
    );
  }
  console.log(`└─ الحكمُ: ${report.verdict} — ${report.statement}`);
}

process.exit(report.exitCode);
