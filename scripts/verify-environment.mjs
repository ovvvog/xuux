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

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { ENV_ERRORS, Environment } from '../src/environment/index.mjs';
import { collectObservations, detectProfile } from './lib/environment-facts.mjs';
import {
  EnvironmentLedger,
  auditLedgerFile,
  defaultLedgerPath,
  frozenLedgerPath,
} from './lib/environment-ledger.mjs';

/** @param {string} name @returns {string | null} */
function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? null : found.slice(prefix.length);
}

const asJson = process.argv.includes('--json');
const configDir = flag('dir');
const ledgerPath = flag('ledger') ?? defaultLedgerPath(process.cwd());
// **الفاحصُ لا يُنشئ مجلَّدَ السجلِّ**: لو أنشأه لكان يُصلِح المجلَّدَ الذي
// يفحص مجسٌّ حاسمٌ حضورَه، فيسقط المجسُّ مرّةً ثم يقوم بلا إقامةٍ — فحصٌ
// يُخضِّر نفسَه بالتشغيلِ الثاني. وعند غيابِه يُعلَن القيدُ مُسقَطاً.
const ledger = new EnvironmentLedger(ledgerPath, { createDir: false });

// **الحكمُ على الدفترِ يُقرأ قبلَ أن يكتُبَ الفاحصُ فيه سطراً واحداً** — وإلّا لقاس
// أثرَ نفسِه لا ما وجدَ. وما تتسامح معه الإقامةُ يرفضُه الفاحصُ: `ADR 0008`.
const ledgerAudit = auditLedgerFile(ledgerPath);

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
      ledger: {
        state: ledgerAudit.state,
        refuses: ledgerAudit.refuses,
        committed: ledgerAudit.committed,
        present: ledgerAudit.present,
        detail: ledgerAudit.detail,
      },
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
  const ledgerMark = ledgerAudit.refuses ? '⛔' : ledgerAudit.state === 'intact' ? '✅' : 'ℹ️ ';
  console.log(`│ ${ledgerMark} دفترُ الأثرِ [${ledgerAudit.state}] — ${ledgerAudit.detail}`);
  if (fs.existsSync(frozenLedgerPath(ledgerPath))) {
    console.log(
      `│ ℹ️  دفترٌ مُجمَّدٌ ما قبلَ ADR 0008 حاضرٌ: ${frozenLedgerPath(ledgerPath)} — لا يُكتَب فيه ولا يُهاجَر منه؛ ولا يدخل في هذا الحكمِ لأنّه بلا رأسٍ يُشهَد به.`,
    );
  }
  console.log(`└─ الحكمُ: ${report.verdict} — ${report.statement}`);
  if (report.verdict === 'unfit') {
    console.error(
      '⛔ بيئةٌ غيرُ صالحةٍ. أعِد `npm run bootstrap` — كلُّ طورٍ متكافئٌ فلا يُفسِد ما قام.',
    );
  }
}

// **فشلٌ مغلَقٌ على مسارِ التحقّقِ وحدَه (`ADR 0008`):** إن كان دفترُ الأثرِ
// مبتوراً أو مُبدَّلاً أو بلا رأسٍ يشهد به، فلا يُقال عن البيئةِ «صالحةٌ»: حكمٌ
// يستند إلى أثرٍ لا يُوثَق به حكمٌ بلا سند. **والإقامةُ لا تُعطَّل بهذا** — تمضي
// وتُعلِن الحجرَ، فمن ربط إصلاحَ البيئةِ بسلامةِ دفترِها أغلق بابَ الإصلاحِ على نفسِه.
if (ledgerAudit.refuses) {
  const code = ENV_ERRORS.LEDGER_BROKEN;
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, code, message: ledgerAudit.detail, ledger: ledgerAudit })}\n`,
    );
  } else {
    console.error(`⛔ دفترُ أثرِ الإقامةِ مرفوضٌ [${code}]: ${ledgerAudit.detail}`);
  }
  process.exit(environment.exitCodeFor('unfit'));
}

process.exit(report.exitCode);
