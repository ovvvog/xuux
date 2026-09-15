#!/usr/bin/env node
/**
 * مولِّدُ تقريرِ الجاهزيّةِ — أمرٌ واحدٌ (الخطوة `M11.08`).
 *
 *   node scripts/readiness-report.mjs            # يقيس ويُقارن (بلا كتابةٍ)
 *   node scripts/readiness-report.mjs --write    # يُصدِر التقريرَ إلى موضعِه
 *   node scripts/readiness-report.mjs --json     # حكمٌ آليٌّ يُقرأ برنامجياً
 *
 * **بلا خطوةٍ يدويّةٍ:** لا عَلَمَ تخطٍّ، ولا إنجاحٍ قسريٍّ، ولا قراءةَ مَدخلٍ
 * قياسيٍّ، ولا سؤالَ تأكيدٍ. ووسيطٌ غيرُ معروفٍ **يُرَدُّ** بحكمِ
 * `readiness:unmeasured` — فأداةٌ تتجاهل وسيطاً لم تفهمْه قد تكون فهمت شيئاً آخرَ.
 *
 * **والضمانُ `G-READINESS-DRIFT-DETECTED` يُنفَّذ هنا:** التقريرُ المُقيَّدُ في
 * المستودعِ يُقارَن **بايتاً ببايتٍ** بالمولَّدِ من الحقيقةِ الراهنةِ، وانزياحُه
 * يُصدِر `readiness:incomplete`.
 *
 * **ورمزُ الخروجِ هو الحكمُ:** `readiness:reported` ⇒ 0 وحدَه، والنقصُ ⇒ 82، وعدمُ
 * القياسِ ⇒ 83.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { collectReadinessFacts } from './lib/readiness-facts.mjs';
import { loadDeferrals, loadReadinessContract, REPO_ROOT } from '../src/readiness/contract.mjs';
import { READINESS_ERRORS, ReadinessError } from '../src/readiness/errors.mjs';
import { exitCodeFor } from '../src/readiness/judgement.mjs';
import {
  COVERAGE_BANNER_TITLE,
  NOT_APPROVAL_CLAIMS,
  renderReport,
  VERDICT_QUALIFIER,
} from '../src/readiness/render.mjs';

const UNMEASURED = 'readiness:unmeasured';
const INCOMPLETE = 'readiness:incomplete';

/**
 * @param {string[]} argv
 * @returns {{ root: string, write: boolean, json: boolean }}
 */
function parseArgs(argv) {
  let root = REPO_ROOT;
  let write = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--root') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new ReadinessError(
          READINESS_ERRORS.ARGUMENT_UNKNOWN,
          'الوسيطُ `--root` بلا قيمةٍ — ومسارٌ مجهولٌ لا يُقاس عليه.',
        );
      }
      root = path.resolve(value);
      index += 1;
      continue;
    }
    throw new ReadinessError(
      READINESS_ERRORS.ARGUMENT_UNKNOWN,
      `وسيطٌ غيرُ معروفٍ «${String(arg)}» — ولا تُنفَّذ نيّةٌ مظنونةٌ.`,
    );
  }
  return { root, write, json };
}

/**
 * @returns {number}
 */
function main() {
  /** @type {{ root: string, write: boolean, json: boolean }} */
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    const detail =
      error instanceof ReadinessError ? `${error.code}: ${error.message}` : String(error);
    process.stderr.write(`⛔ ${UNMEASURED}: ${detail}\n`);
    return 83;
  }

  let contract;
  let deferrals;
  let facts;
  try {
    contract = loadReadinessContract({ configDir: path.join(options.root, 'config') });
    deferrals = loadDeferrals({ configDir: path.join(options.root, 'config') });
    facts = collectReadinessFacts({ root: options.root, contract, deferrals });
  } catch (error) {
    const detail =
      error instanceof ReadinessError ? `${error.code}: ${error.message}` : String(error);
    process.stderr.write(`⛔ ${UNMEASURED}: ${detail}\n`);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ verdict: UNMEASURED, detail }, null, 2)}\n`);
    }
    return 83;
  }

  const sources = /** @type {Record<string, string>} */ (contract.sources);
  const outputFile = path.join(options.root, sources.output ?? 'docs/READINESS_REPORT.md');
  const rendered = `${renderReport({
    items: facts.items,
    judgement: facts.judgement,
    deferrals,
    project: facts.project,
    contract: /** @type {{ objective: { statement: string, limit: string }, version: string }} */ (
      contract
    ),
  })}\n`;

  let drift = false;
  if (options.write) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, rendered, 'utf8');
  } else {
    const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
    drift = current !== rendered;
  }

  let verdict = facts.judgement.verdict;
  if (drift && verdict !== UNMEASURED) verdict = INCOMPLETE;
  const exitCode = exitCodeFor(
    /** @type {{ verdicts: { id: string, exitCode: number }[] }} */ (contract),
    verdict,
  );

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          verdict,
          // `LIVE-2`: قارئُ الآلةِ كان يرى الحكمَ **مُجرَّداً** فيَقرؤه اعتماداً،
          // والحدُّ مكتوبٌ في متنِ الوثيقةِ لا في المَخرَجِ الذي يقرؤه. فصارَ
          // الحدُّ **ملازماً للقيمةِ في المَخرَجِ نفسِه**، ومصدرُه واحدٌ مع المتنِ.
          verdictKind: 'coverage-not-approval',
          verdictQualifier: VERDICT_QUALIFIER,
          banner: COVERAGE_BANNER_TITLE,
          limit: /** @type {{ objective: { limit: string } }} */ (contract).objective.limit,
          doesNotImply: [...NOT_APPROVAL_CLAIMS],
          exitCode,
          drift,
          coverage: facts.judgement.coverage,
          faults: facts.judgement.faults,
          project: facts.project,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  const lines = [];
  lines.push('═══ تقرير الجاهزية (M11.08) ═══');
  lines.push('');
  lines.push(`البنودُ المقروءةُ: ${String(facts.judgement.coverage.total)}`);
  lines.push(`بدليلٍ: ${String(facts.judgement.coverage.evidenced)}`);
  lines.push(`مؤجَّلةٌ تأجيلاً مُصرَّحاً: ${String(facts.judgement.coverage.deferred)}`);
  lines.push(`بلا دليلٍ ولا تأجيلٍ: ${String(facts.judgement.coverage.uncovered)}`);
  if (drift) {
    lines.push('');
    lines.push(
      `⛔ ${READINESS_ERRORS.REPORT_DRIFT}: التقريرُ المُقيَّدُ في المستودعِ منزاحٌ عن الحقيقةِ الراهنةِ — شغِّلْ \`npm run readiness:report\`.`,
    );
  }
  for (const fault of facts.judgement.faults) {
    lines.push(`   - ${fault.code} · ${fault.id}: ${fault.evidence}`);
  }
  lines.push('');
  lines.push(
    verdict === 'readiness:reported'
      ? '✅ الحكمُ: readiness:reported — كلُّ بندٍ بدليلٍ أو بتأجيلٍ مُصرَّحٍ. **تغطيةٌ مقيسةٌ لا اعتمادٌ: لا مراجعةً مستقلّةً ولا G11 ولا إطلاقاً ولا 100%.**'
      : `⛔ الحكمُ: ${verdict}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return exitCode;
}

process.exitCode = main();
