#!/usr/bin/env node
/**
 * فحصُ صحّةِ البيئةِ — `npm run verify:env` (الخطوة `M10.05`).
 *
 * **هذا السكربتُ يستبدل القالبَ `scripts/verify_environment.sh`** الذي كان
 * تعليقاتٍ لا تفحص شيئاً (تدقيقُ خطِّ الأساس §2.4). وقبله كان الجوابُ الوحيدُ
 * لسؤالِ «هل هذه البيئةُ صالحةٌ؟» **تشغيلَ البوابةِ كلِّها ورؤيةَ ما يسقط** —
 * وذاك تشخيصٌ بالفشلِ لا فحصُ صحّة: يستغرق دقائقَ، ويُخرِج خطأً في مكانٍ لا
 * يدلّ على سببِه، ولا يُفرِّق بين نقصٍ يُعطِّل ونقصٍ يُنقِص.
 *
 * **ولا يُصلِح شيئاً** (الضمان `G-ENV-VERIFY-READ-ONLY`): المجساتُ قراءةٌ محضةٌ،
 * وتقييمُها في `src/environment/probes.mjs` التي **لا تستورد `node:fs` ولا
 * `node:child_process` أصلاً** فلا تستطيع أن تكتب. وما يُكتَب هنا قيدُ أثرٍ في
 * السجلِّ لا إصلاحٌ للبيئةِ المفحوصة.
 *
 * **والحكمُ من الدرجاتِ لا من العدَد:** مجسٌّ `critical` واحدٌ ساقطٌ ⇒ `unfit`
 * ورمزُ خروجٍ غيرُ صفريٍّ ولو نجح ما سواه؛ ومجسٌّ `warning` ساقطٌ ⇒ `degraded`
 * برمزٍ صفريٍّ **ونقصٌ يُقال بالاسمِ لا يُسكَت**. ورموزُ الخروجِ كلُّها من
 * `config/environment.yaml` لا من هذا الملف.
 *
 * الأعلام: `--json` مخرَجٌ آليّ · `--dir=<path>` مجلَّدُ الوثائق ·
 * `--ledger=<path>` ملفُّ سجلِّ الأثر.
 */

import path from 'node:path';
import process from 'node:process';

import { Environment } from '../src/environment/index.mjs';
import { collectObservations, detectProfile } from './lib/environment-facts.mjs';
import { EnvironmentLedger } from './lib/environment-ledger.mjs';

/** @param {string} name @returns {string | null} */
function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

const asJson = process.argv.includes('--json');
const configDir = flag('dir');
const ledgerPath =
  flag('ledger') ?? path.join(process.cwd(), '.state', 'logs', 'environment.jsonl');
// **الفاحصُ لا يُنشئ مجلَّدَ السجلِّ**: لو أنشأه لكان يُصلِح المجلَّدَ الذي
// يفحص مجسٌّ حاسمٌ حضورَه، فيسقط المجسُّ مرّةً ثم يقوم بلا إقامةٍ — فحصٌ
// يُخضِّر نفسَه بالتشغيلِ الثاني. وعند غيابِه يُعلَن القيدُ مُسقَطاً.
const ledger = new EnvironmentLedger(ledgerPath, { createDir: false });

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

/** @type {import('../src/environment/probes.mjs').HealthReport} */
let report;
try {
  report = environment.verify(collectObservations(contract), { actor: 'system@verify' });
} catch (error) {
  const code = /** @type {{ code?: string }} */ (error).code ?? 'ENV_PROBE_MISSING';
  const message = error instanceof Error ? error.message : String(error);
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, code, message })}\n`);
  } else {
    console.error(`⛔ فحصُ الصحّةِ توقّف [${code}]: ${message}`);
  }
  process.exit(environment.exitCodeFor('unfit'));
}

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      profile: detectProfile(),
      verdict: report.verdict,
      exitCode: report.exitCode,
      auditWritten: ledger.count,
      auditDropped: ledger.dropped,
      criticalFailures: report.criticalFailures,
      warningFailures: report.warningFailures,
      probes: report.results.map((result) => ({
        probe: result.probe,
        kind: result.kind,
        severity: result.severity,
        satisfied: result.satisfied,
        detail: result.detail,
      })),
    })}\n`,
  );
} else {
  console.log('┌─ فحصُ صحّةِ البيئةِ — الخطوة M10.05 (قراءةٌ محضةٌ، لا إصلاحَ)');
  console.log(`│ الوضعُ المقروءُ: ${detectProfile()}`);
  for (const result of report.results) {
    const mark = result.satisfied ? '✅' : result.severity === 'critical' ? '⛔' : '⚠️ ';
    console.log(`│ ${mark} ${result.probe} [${result.severity}] — ${result.detail}`);
  }
  console.log(
    `│ الساقطُ: ${String(report.criticalFailures)} حاسمٌ و${String(report.warningFailures)} تحذيريّ`,
  );
  if (ledger.dropped > 0) {
    console.log(
      `│ قيدُ الأثرِ مُسقَطٌ (${String(ledger.dropped)}): مجلَّدُ السجلِّ «${path.dirname(ledger.file)}» غائبٌ، والفاحصُ لا يُنشئه — فالإسقاطُ يُقال ولا يُسكَت.`,
    );
  }
  console.log(`└─ الحكمُ: ${report.verdict} — ${report.statement}`);
  if (report.verdict === 'unfit') {
    console.error(
      '⛔ بيئةٌ غيرُ صالحةٍ. أعِد `npm run bootstrap` — كلُّ طورٍ متكافئٌ فلا يُفسِد ما قام.',
    );
  }
}

process.exit(report.exitCode);
