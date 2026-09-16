#!/usr/bin/env node
/**
 * تجربةُ التعافي الدوريّةُ المؤتمتة — الخطوة `M10.08`.
 *
 * **معيارُ القبولِ بحرفِه:** «تجربة ربع سنوية موثَّقة تحقّق زمن التعافي
 * المعلَن». فهذا المنفِّذُ يُجري **استعادةً كاملةً إلى بيئةٍ نظيفةٍ** بأمرٍ واحدٍ
 * بلا تدخّلٍ بين طورٍ وطورٍ: نسخٌ فبصمٌ، ثم **تفريغُ جذرِ الاستعادةِ حتى يصير
 * خالياً فعلاً**، ثم استعادةٌ، ثم **مطابقةُ بصمةٍ ملفّاً ملفّاً** ثم قراءةُ
 * المُستعادِ فعلاً — ثم يُحاسِب زمنَ التعافي على العهدِ المعلَن.
 *
 * والاستعمال:
 *
 * ```
 * node scripts/recovery-drill.mjs [--root .] [--no-seed] [--json]
 * ```
 *
 * و`--no-seed` يُجري التجربةَ على حالةٍ **مُهيَّأةٍ سابقاً** في الجذرِ المُمرَّرِ
 * بدل أن يُهيِّئها؛ فحالةٌ يُنشِئها المنفِّذُ نفسَه لا تُثبت أنه يستعيد حالةَ
 * غيرِه، ونسخةٌ لنفسِها ليست تعافياً.
 *
 * ورموزُ الخروجِ مقروءةٌ من العقدِ لا مكتوبةٌ هنا: `recovery:met` ⇒ 0،
 * و`recovery:missed` ⇒ 74 عند تجاوزِ زمنِ التعافي عهدَه أو اختلافِ بصمةٍ،
 * و`recovery:unmeasured` ⇒ 75 عند غيابِ قياسٍ صالحٍ — فمن لم يُقَس لا يُقال إنه
 * تعافى.
 *
 * **وتحديثُ `WL-191`:** هذه التجربةُ **مجدوَلةٌ الآنَ** بالعملِ
 * `job:recovery-drill` في `config/schedule.yaml` (كلَّ 168 ساعةً بمَهَلِ 24، وهو
 * أضيقُ من عهدِ التسعينَ يوماً في `config/recovery.yaml`)، ويُطلِقُها
 * `scripts/scheduler.mjs` بلا نداءٍ يدويٍّ لكلِّ تشغيلٍ. والدوريّةُ تبقى عهداً
 * يُقاس فواتُه **من الدفترِ** ويُعرَض بـ`--json`: الجدولةُ لا تُلغي القياسَ.
 *
 * **وحدودٌ معلَنة باقيةٌ:** والنسخُ
 * نسخُ ملفّاتٍ على القرصِ نفسِه لا نسخٌ خارجَ الجهازِ ولا مخزنُ كائناتٍ، ولا
 * تُستعاد جداولُ قاعدةِ بياناتٍ. وكلُّ ذلك مسجَّلٌ ديناً معلَناً في
 * `docs/REMAINING_WORK.md` و`docs/RECOVERY.md` لا سهواً يُكتشَف.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadRecoveryContract, RECOVERY_ERRORS, RecoveryError } from '../src/recovery/index.mjs';
import { loadRegionsContract } from '../src/regions/index.mjs';
import { replicate, seedRegions, writeToWriter } from './lib/region-facts.mjs';
import { measureDueness, runRecoveryDrill } from './lib/recovery-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * @param {string[]} argv
 * @returns {{ root: string, seed: boolean, json: boolean }}
 */
function parseArguments(argv) {
  /** @type {{ root: string, seed: boolean, json: boolean }} */
  const options = { root: ROOT, seed: true, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--root') {
      options.root = path.resolve(argv[index + 1] ?? '.');
      index += 1;
    } else if (flag === '--no-seed') {
      options.seed = false;
    } else if (flag === '--json') {
      options.json = true;
    } else {
      throw new RecoveryError(RECOVERY_ERRORS.CONFIG_INVALID, `وسيطٌ غيرُ معروف: «${flag}».`);
    }
  }
  return options;
}

/** @returns {number} */
function now() {
  return Date.now();
}

// ووسيطٌ غيرُ معروفٍ يُرَدُّ **بحكمٍ مقروءٍ** لا بأثرِ مكدّسٍ: قراءةُ الوسائطِ
// نفسُها تقع داخلَ الحراسةِ، و«--json» يُقرأ من السطرِ مباشرةً حتى يُصدَر التقريرُ
// بصيغتِه المطلوبةِ ولو فسد ما بعده.
const ARGV = process.argv.slice(2);
const JSON_REQUESTED = ARGV.includes('--json');
const contract = loadRecoveryContract();
/** @type {{ root: string, seed: boolean, json: boolean }} */
let options;

/**
 * رمزُ الخروجِ المقروءُ من العقدِ لخطأِ مسارِ التعافي.
 *
 * @param {RecoveryError} error
 * @returns {string}
 */
function verdictForError(error) {
  /** @type {Set<string>} */
  const unmeasured = new Set([
    RECOVERY_ERRORS.CLOCK_INVALID,
    RECOVERY_ERRORS.BACKUP_EMPTY,
    RECOVERY_ERRORS.PHASE_SKIPPED,
    RECOVERY_ERRORS.LEDGER_INVALID,
  ]);
  return unmeasured.has(error.code) ? 'recovery:unmeasured' : 'recovery:missed';
}

/** @param {string} verdictId @returns {number} */
function codeOf(verdictId) {
  const verdict = contract.verdicts.find((entry) => entry.id === verdictId);
  return verdict === undefined ? 1 : verdict.exitCode;
}

/** @type {Record<string, unknown>} */
const report = {
  cadence: `${String(contract.cadence.everyDays)} يوماً (${contract.cadence.label})`,
  maxRecoveryMs: contract.objective.maxRecoveryMs,
  maxDataLossMs: contract.maxDataLossMs,
  phases: null,
  totalMs: null,
  files: null,
  dueness: null,
  verdict: 'recovery:met',
  reason: null,
};

try {
  options = parseArguments(ARGV);

  // تهيئةٌ ثم كتابةٌ ثم نسخٌ: حالةُ ما قبل النسخةِ الاحتياطيّةِ مبنيّةٌ لا مُفترَضة.
  if (options.seed) {
    const regions = loadRegionsContract();
    seedRegions({ contract: regions, root: options.root, at: now() });
    writeToWriter({ contract: regions, root: options.root, record: 'pre-backup', at: now() });
    replicate({ contract: regions, root: options.root, at: now(), lagMs: 0 });
  }

  const outcome = runRecoveryDrill(contract, { root: options.root, clock: now });
  report.phases = outcome.phases.map((phase) => ({
    id: phase.id,
    ms: phase.endedAt - phase.startedAt,
  }));
  report.totalMs = outcome.totalMs;
  report.files = outcome.files;
  report.verdict = outcome.verdict;
  report.statement = outcome.statement;
  report.dueness = measureDueness(contract, { root: options.root, at: now() });
  emit(report, outcome.exitCode);
} catch (error) {
  if (error instanceof RecoveryError) {
    report.verdict = verdictForError(error);
    report.reason = error.code;
    report.message = error.message;
    emit(report, codeOf(String(report.verdict)));
  }
  throw error;
}

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
    console.log('═══ تجربة التعافي الدوريّة ═══');
    console.log(`   الدوريّة: ${String(payload.cadence)}`);
    const phases = /** @type {{ id: string, ms: number }[] | null} */ (payload.phases);
    if (phases !== null) {
      for (const phase of phases) {
        console.log(`   • ${phase.id}: ${String(phase.ms)} ملّي ثانية.`);
      }
    }
    const dueness = /** @type {{ statement?: string } | null} */ (payload.dueness);
    if (dueness !== null && dueness.statement !== undefined) {
      console.log(`   • ${dueness.statement}`);
    }
    if (payload.verdict === 'recovery:met') {
      console.log(
        `✅ ${String(payload.statement)} فبيئةٌ نظيفةٌ أُفرِغت فعلاً، ومطابقةٌ بالبصمةِ ملفّاً ملفّاً ثم قراءةٌ من المُستعاد، وزمنٌ محاسَبٌ على عهدٍ معلَنٍ في العقدِ لا على تقديرٍ لاحقٍ، ولا «VERIFIED» بلا مراجعةٍ مستقلّةٍ.`,
      );
    } else {
      console.log(`⛔ ${String(payload.verdict)}: ${String(payload.reason ?? payload.statement)}`);
      if (payload.message !== undefined) {
        console.log(`   ${String(payload.message)}`);
      }
    }
  }
  process.exit(code);
}
