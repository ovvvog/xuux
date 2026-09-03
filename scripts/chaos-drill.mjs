#!/usr/bin/env node
/**
 * منفِّذُ تجاربِ الفوضى — الخطوة `M10.09`.
 *
 * **معيارُ القبولِ بحرفِه:** تجاربُ فوضى تُحقِن عطباً **حقيقيّاً** وتقيس صمودَ
 * فرضيّةٍ مكتوبةٍ، ويُقيَّد كلُّ انحرافٍ ويُربَط بإصلاحٍ موثَّقٍ لسببِه. فهذا
 * المنفِّذُ يُجري التجاربَ الخمسَ بترتيبِ العقدِ بأمرٍ واحدٍ بلا تدخّلٍ بين
 * تجربةٍ وتجربةٍ: يقتل عمليّةً ابناً بـ`SIGKILL`، ويقيس تأخّراً حقيقيّاً على
 * ساعةٍ، ويوجِّه دفتراً إلى جهازٍ يردُّ الكتابةَ، ويدسُّ سطراً فاسداً، ويكتب
 * سجلًّا تاريخُه في المستقبل — ثم يحكم من النتائجِ لا من نيّتِه.
 *
 * والاستعمال:
 *
 * ```
 * node scripts/chaos-drill.mjs [--root .] [--json]
 * ```
 *
 * **والضمان `G-CHAOS-NO-SKIP-FLAG` بنيةٌ في هذا الملفِّ لا وعدٌ في وثيقةٍ:**
 * لا وسيطَ هنا إلا `--root` و`--json`؛ فلا علَمَ تخطًٍ ولا علَمَ إنجاحٍ قسريٍّ ولا
 * تجاوزَ لتجربةٍ، **ووسيطٌ غيرُ معروفٍ يُرَدُّ بحكمِ رفضٍ** لا يُتجاهَل.
 * وأسماءُ الأعلامِ الممنوعةِ لا تُكتَب في هذا الملفِّ أصلاً — حتّى في تعليقٍ — لأنّ
 * الحاجزَ يقرأ النّصَ لا النيّةَ، وموضعُ إعلانِها `docs/CHAOS.md`. ولو
 * كان في المنفِّذِ عَلَمُ تخطٍّ واحدٌ لصار — في أوّلِ يومٍ ضيّقٍ — هو الطريقةَ
 * المعتادةَ لتشغيلِ الفوضى، فتُخضَّر بوابةٌ لم يقع تحتها عطب.
 *
 * ورموزُ الخروجِ مقروءةٌ من العقدِ لا مكتوبةٌ هنا: `chaos:resilient` ⇒ 0،
 * و`chaos:deviated` ⇒ 76، و`chaos:unmeasured` ⇒ 77 — **ولا يخرج صفراً إلا
 * الصمودُ وحدَه**.
 *
 * **حدودٌ معلَنة:** الفوضى تقع في جذرٍ واحدٍ داخلَ `.state/chaos` ولا تُلمَس
 * حالةٌ خارجَه؛ ولا مُجدوِلَ ذاتيَّ يُطلِق هذه التجاربَ من نفسِه؛ وتجربةُ
 * امتلاءِ القرصِ تحتاج `/dev/full` فإن غاب أُعلِن الحكمُ **غيرَ مقيسٍ** لا
 * صموداً. وكلُّ ذلك مسجَّلٌ في `docs/CHAOS.md` و`docs/REMAINING_WORK.md`.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CHAOS_ERRORS,
  ChaosError,
  assertPlanCovered,
  exitCodeFor,
  judgeRun,
  loadChaosContract,
} from '../src/chaos/index.mjs';
import { appendChaosLedger, runExperiments } from './lib/chaos-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * @param {string[]} argv
 * @returns {{ root: string, json: boolean }}
 */
function parseArguments(argv) {
  /** @type {{ root: string, json: boolean }} */
  const options = { root: ROOT, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--root') {
      options.root = path.resolve(argv[index + 1] ?? '.');
      index += 1;
    } else if (flag === '--json') {
      options.json = true;
    } else {
      throw new ChaosError(
        CHAOS_ERRORS.CONFIG_INVALID,
        `وسيطٌ غيرُ معروف: «${flag}» — ولا عَلَمَ تخطٍّ في منفِّذِ الفوضى أصلاً.`,
      );
    }
  }
  return options;
}

/** @returns {number} */
function now() {
  return Date.now();
}

const ARGV = process.argv.slice(2);
const JSON_REQUESTED = ARGV.includes('--json');
const contract = loadChaosContract();

/** @param {string} verdictId @returns {number} */
function codeOf(verdictId) {
  try {
    return exitCodeFor(contract, verdictId);
  } catch {
    return 1;
  }
}

/** @type {Record<string, unknown>} */
const report = {
  experiments: contract.experiments.length,
  root: contract.source.root,
  results: null,
  deviations: null,
  verdict: 'chaos:unmeasured',
  reason: null,
};

/**
 * إصدارُ التقريرِ ثم الخروجُ برمزِ الحكمِ — والمسارُ الآليُّ يقرأ الرمزَ.
 *
 * @param {Record<string, unknown>} payload
 * @param {number} code
 * @returns {never}
 */
function emit(payload, code) {
  if (JSON_REQUESTED) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('═══ تجارب الفوضى ═══');
    const results =
      /** @type {{ experiment: string, injected: boolean, upheld: boolean, evidence: string }[] | null} */ (
        payload.results
      );
    if (results !== null) {
      for (const result of results) {
        const mark = result.injected ? (result.upheld ? '✅' : '⛔') : '⚠️';
        console.log(`   ${mark} ${result.experiment}: ${result.evidence}`);
      }
    }
    const deviations =
      /** @type {{ code: string, closed: boolean, closedBy: string | null }[] | null} */ (
        payload.deviations
      );
    if (deviations !== null && deviations.length > 0) {
      for (const deviation of deviations) {
        console.log(
          `   • انحراف ${deviation.code}: ${deviation.closed ? `مُغلَقٌ بـ${String(deviation.closedBy)}` : 'مفتوحٌ بلا مُدخلةِ عملٍ تُغلِقه'}.`,
        );
      }
    }
    if (payload.verdict === 'chaos:resilient') {
      console.log(
        `✅ ${String(payload.reason)} فالعطبُ وقع حقيقةً في عمليّةٍ وقرصٍ وساعةٍ ودفترٍ، والحكمُ مقروءٌ من العقدِ لا مكتوبٌ في المنفِّذِ، ولا «VERIFIED» بلا مراجعةٍ مستقلّةٍ.`,
      );
    } else {
      console.log(`⛔ ${String(payload.verdict)}: ${String(payload.reason)}`);
    }
  }
  process.exit(code);
}

try {
  const options = parseArguments(ARGV);
  const at = now();
  const results = await runExperiments({ contract, root: options.root, at });
  const covered = assertPlanCovered(contract, results);
  const judgement = judgeRun({ contract, results: covered });
  report.results = covered.map((entry) => ({
    experiment: entry.experiment,
    injected: entry.injected,
    upheld: entry.upheld,
    evidence: entry.evidence,
  }));
  report.deviations = judgement.deviations.map((entry) => ({
    code: entry.code,
    experiment: entry.experiment,
    closed: entry.closed,
    closedBy: entry.closedBy,
  }));
  report.verdict = judgement.verdict;
  report.reason = judgement.reason;
  appendChaosLedger({
    contract,
    root: options.root,
    at: now(),
    entry: {
      type: 'chaos.drill.completed',
      verdict: judgement.verdict,
      experiments: judgement.experiments,
      upheld: judgement.upheld,
    },
  });
  emit(report, exitCodeFor(contract, judgement.verdict));
} catch (error) {
  if (error instanceof ChaosError) {
    report.verdict =
      error.code === CHAOS_ERRORS.DEVIATION_UNCLOSED ? 'chaos:deviated' : 'chaos:unmeasured';
    report.reason = `${error.code}: ${error.message}`;
    emit(report, codeOf(String(report.verdict)));
  }
  throw error;
}
