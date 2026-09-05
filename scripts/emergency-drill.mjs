#!/usr/bin/env node
// منفِّذُ تمرينِ الطوارئ الكامل — الخطوة `M11.07`
//
// الغرض:      إجراءُ سلسلةِ الطوارئ كاملةً **بأمرٍ واحدٍ**: إيقافٌ سياديٌّ، فحجْرٌ
//             على شذوذٍ مقيسٍ، فتعافٍ بعمليّةٍ ابنةٍ حقيقيّةٍ، فاستئنافٌ بإقرارِ
//             العقدةِ الحيّةِ، فتقريرٌ بزمنِ كلِّ طورٍ — ثم حكمٌ برمزِ خروجٍ.
// المدخلات:   --root <مسار>   جذرُ حالةِ التمرينِ (افتراضُه مجلَّدُ العمل)
//             --json          تقريرٌ آليٌّ على المخرَجِ القياسيّ
// المخرجات:   تقريرٌ عربيٌّ مقروءٌ أو JSON، ورمزُ خروجٍ من العقدِ:
//               0  emergency:ready       الأطوارُ الخمسةُ وقعت وأُنفِذت في عهدِها
//               78 emergency:failed      طورٌ لم يقع إنفاذُه أو زمنٌ جاوز عهدَه
//               79 emergency:unmeasured  لم يقع قياسٌ صالحٌ أصلاً
// التشغيل:    node scripts/emergency-drill.mjs --json
// الاختبار:   node --test tests/emergency/drill.test.mjs
// الصلاحيات:  كتابةٌ داخل جذرِ حالةِ التمرينِ وحدَه، وتشغيلُ منفِّذِ التعافي
//             عمليّةً ابنةً. لا يلمس حالةَ تشغيلٍ حقيقيّةً ولا يمرُّ ببوابةِ التاج.
// المالك:     مسؤولُ الجاهزيّةِ التشغيليّة.
//
// **الضمانُ `G-EMERGENCY-NO-SKIP-FLAG`:** لا عَلَمَ تخطٍّ ولا إنجاحٍ قسريٍّ في هذا
// الملفِّ أصلاً — لا مُعرَّفاً ولا مُسمّىً ولا مُعلَّقاً عليه؛ والوسائطُ المقبولةُ
// اثنان فقط، وما سواهما يُرَدُّ بحكمٍ غيرِ مقيسٍ لا يُفسَّر باجتهاد.
//
// **والضمانُ `G-EMERGENCY-ZERO-MANUAL-STEPS`:** التمرينُ يمشي من الإيقافِ إلى
// التقريرِ بلا مُدخلَةِ إنسانٍ بين طورٍ وطورٍ: لا قراءةَ من مَدخلٍ قياسيٍّ ولا
// انتظارَ إذنٍ ولا سؤالَ تأكيد.

import path from 'node:path';
import process from 'node:process';

import {
  EMERGENCY_ERRORS,
  EmergencyError,
  VERDICT_UNMEASURED,
  exitCodeFor,
  judgeDrill,
  loadEmergencyContract,
} from '../src/emergency/index.mjs';
import {
  appendEmergencyEvent,
  collectEmergencyFacts,
  emergencyPaths,
  writeLastDrill,
} from './lib/emergency-facts.mjs';

const USAGE = `الاستعمال:
  node scripts/emergency-drill.mjs [--root <مسار>] [--json]`;

/**
 * يفكّ الوسائطَ ويردُّ ما لا يعرفه — فوسيطٌ يُتجاهَل بابٌ يُدخَل منه لاحقاً
 * بعَلَمِ تخطٍّ.
 *
 * @param {string[]} argv
 * @returns {{ root: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ root: string, json: boolean }} */
  const parsed = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      parsed.json = true;
    } else if (argument === '--root') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new EmergencyError(EMERGENCY_ERRORS.CONFIG_INVALID, `--root بلا قيمة.\n${USAGE}`);
      }
      parsed.root = path.resolve(value);
      index += 1;
    } else {
      throw new EmergencyError(
        EMERGENCY_ERRORS.CONFIG_INVALID,
        `وسيطٌ غيرُ معروفٍ: ${argument}\n${USAGE}`,
      );
    }
  }
  return parsed;
}

/**
 * يطبع التقريرَ العربيَّ المقروءَ — فحكمٌ لا يُقرأ في لحظةٍ حرجةٍ حكمٌ لا يُنفَّذ.
 *
 * @param {import('../src/emergency/judgement.mjs').EmergencyJudgement} judgement
 * @param {Record<string, unknown>} extra
 * @returns {void}
 */
function printHuman(judgement, extra) {
  const lines = [];
  lines.push('تمرينُ الطوارئ الكامل — الخطوة M11.07');
  lines.push('');
  for (const phase of judgement.phases) {
    const mark = phase.enforced && phase.withinBudget ? '✅' : '❌';
    lines.push(`${mark} ${phase.phase}  ${phase.ms}ms / ${phase.maxMs}ms`);
    lines.push(`   الدليل: ${phase.evidence}`);
  }
  lines.push('');
  lines.push(`الزمنُ الكلّيُّ: ${judgement.totalMs}ms  |  العهدُ: ${judgement.objectiveMs}ms`);
  if (typeof extra.reportFile === 'string') {
    lines.push(`التقريرُ: ${extra.reportFile}`);
  }
  if (judgement.reasons.length > 0) {
    lines.push('');
    lines.push('الأسبابُ:');
    for (const reason of judgement.reasons) {
      lines.push(`  - [${reason.code}] ${reason.message}`);
    }
  }
  lines.push('');
  lines.push(`الحكمُ: ${judgement.verdict}`);
  lines.push(
    'حدٌّ معلَنٌ: هذا التمرينُ يُثبت جاهزيّةَ الآلةِ لا سلامةَ النظامِ ولا اعتمادَه، ولا يُقرأ مراجعةً مستقلّةً ولا إذناً بإطلاق.',
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const contract = loadEmergencyContract();
  const facts = await collectEmergencyFacts({ root: options.root, contract });
  const judgement = judgeDrill(contract, {
    phases: facts.phases,
    ...(facts.reportPhaseIds === undefined ? {} : { reportPhaseIds: facts.reportPhaseIds }),
  });
  const exitCode = exitCodeFor(contract, judgement.verdict);
  const at = Date.now();
  appendEmergencyEvent(facts.paths, {
    type: 'emergency.drill.completed',
    at,
    detail: {
      verdict: judgement.verdict,
      exitCode,
      totalMs: judgement.totalMs,
      reasons: judgement.reasons.map((reason) => reason.code),
    },
  });
  writeLastDrill(facts.paths, { verdict: judgement.verdict, at, totalMs: judgement.totalMs });

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          drill: 'M11.07',
          contractVersion: contract.version,
          verdict: judgement.verdict,
          exitCode,
          totalMs: judgement.totalMs,
          objectiveMs: judgement.objectiveMs,
          phases: judgement.phases,
          reasons: judgement.reasons,
          reportFile: facts.state.reportFile ?? null,
          ledger: facts.paths.ledger,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    printHuman(judgement, { reportFile: facts.state.reportFile });
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    // الرفضُ يُقيَّد في الدفترِ قبل الخروجِ إن أمكن: تمرينٌ رُفِض واقعةٌ تُقرأ لا
    // صمتٌ يُنسى. وإن تعذّر التقييدُ فلا يُبدَّل الحكمُ من أجلِ ذلك.
    const code = error instanceof EmergencyError ? error.code : EMERGENCY_ERRORS.CONFIG_INVALID;
    const message = error instanceof Error ? error.message : String(error);
    try {
      const contract = loadEmergencyContract();
      // الجذرُ يُقرأ قراءةً متسامحةً هنا لا بالفكِّ الصارمِ: الرفضُ قد يكون سببُه
      // الوسائطَ نفسَها، فيُقيَّد في الجذرِ المقصودِ إن ذُكر لا في مجلَّدٍ آخر.
      const rootIndex = process.argv.indexOf('--root');
      const rootValue = rootIndex === -1 ? undefined : process.argv[rootIndex + 1];
      const root =
        rootValue === undefined || rootValue.startsWith('--')
          ? process.cwd()
          : path.resolve(rootValue);
      appendEmergencyEvent(emergencyPaths(root, contract), {
        type: 'emergency.drill.refused',
        at: Date.now(),
        detail: { code, message },
      });
      process.stderr.write(`❌ [${code}] ${message}\n`);
      process.exitCode = exitCodeFor(contract, VERDICT_UNMEASURED);
    } catch {
      process.stderr.write(`❌ [${code}] ${message}\n`);
      process.exitCode = 79;
    }
  },
);
