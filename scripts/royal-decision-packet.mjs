#!/usr/bin/env node
/**
 * مولِّدُ حزمةِ القرارِ الملكيِّ — **تجهيزٌ لا قرارٌ** (الخطوة `M11.09`).
 *
 *   node scripts/royal-decision-packet.mjs           # يُجهِّز ويُقارن (بلا كتابةٍ)
 *   node scripts/royal-decision-packet.mjs --write   # يُصدِر الوثيقةَ إلى موضعِها
 *   node scripts/royal-decision-packet.mjs --json    # حكمٌ آليٌّ يُقرأ برنامجياً
 *
 * **ما لا يفعلُه هذا الأمرُ:** لا يُصدِر قراراً، ولا يُوقِّع، ولا يُقيِّد واقعةً في
 * سجلِّ الأحداثِ، ولا يُغيِّر صفَّ `M11.09` في لوحةِ الخطواتِ، ولا يُطلِق شيئاً.
 * وهو يُخفِق إن وجدَ في العقدِ قراراً أو توقيعاً — لأنَّ حزمةَ تجهيزٍ فيها قرارٌ
 * انتحالُ سلطةٍ لا تجهيزٌ لها.
 *
 * **ورمزُ الخروجِ هو الحكمُ:** `royal-decision:prepared` ⇒ 0 وحدَه، والنقصُ ⇒ 84،
 * وانتحالُ القرارِ ⇒ 85.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  loadRoyalDecisionPacket,
  assertStepOpen,
  PREPARED_VERDICT,
  REPO_ROOT,
} from '../src/royal-decision/contract.mjs';
import { ROYAL_DECISION_ERRORS, RoyalDecisionError } from '../src/royal-decision/errors.mjs';
import { renderRoyalDecisionPacket } from '../src/royal-decision/render.mjs';

const INCOMPLETE = 'royal-decision:incomplete';
const IMPERSONATED = 'royal-decision:impersonated';
const OUTPUT = 'docs/ROYAL_DECISION_PACKET.md';

/** رموزُ الرفضِ التي تُقرأ **انتحالَ قرارٍ** لا نقصاً في التجهيزِ. */
/** @type {Set<string>} */
const IMPERSONATION_CODES = new Set([
  ROYAL_DECISION_ERRORS.SELF_SIGNED,
  ROYAL_DECISION_ERRORS.SELF_APPROVAL,
  ROYAL_DECISION_ERRORS.LAUNCH_CLAIM,
  ROYAL_DECISION_ERRORS.STEP_CLOSED,
]);

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
        throw new RoyalDecisionError(
          ROYAL_DECISION_ERRORS.ARGUMENT_UNKNOWN,
          'الوسيطُ `--root` بلا قيمةٍ — ومسارٌ مجهولٌ لا تُجهَّز عليه حزمةٌ.',
        );
      }
      root = path.resolve(value);
      index += 1;
      continue;
    }
    throw new RoyalDecisionError(
      ROYAL_DECISION_ERRORS.ARGUMENT_UNKNOWN,
      `وسيطٌ غيرُ معروفٍ «${String(arg)}» — ولا تُنفَّذ نيّةٌ مظنونةٌ.`,
    );
  }
  return { root, write, json };
}

/**
 * @param {unknown} error
 * @returns {{ verdict: string, exitCode: number, detail: string }}
 */
function judgeError(error) {
  if (error instanceof RoyalDecisionError) {
    const impersonation = IMPERSONATION_CODES.has(error.code);
    return {
      verdict: impersonation ? IMPERSONATED : INCOMPLETE,
      exitCode: impersonation ? 85 : 84,
      detail: `${error.code}: ${error.message}`,
    };
  }
  return { verdict: INCOMPLETE, exitCode: 84, detail: String(error) };
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
    const judged = judgeError(error);
    process.stderr.write(`⛔ ${judged.verdict}: ${judged.detail}\n`);
    return judged.exitCode;
  }

  let rendered;
  try {
    const packet = loadRoyalDecisionPacket({ configDir: path.join(options.root, 'config') });
    assertStepOpen({ root: options.root });
    rendered = `${renderRoyalDecisionPacket(packet)}`;
  } catch (error) {
    const judged = judgeError(error);
    process.stderr.write(`⛔ ${judged.verdict}: ${judged.detail}\n`);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ verdict: judged.verdict, detail: judged.detail }, null, 2)}\n`,
      );
    }
    return judged.exitCode;
  }

  const outputFile = path.join(options.root, OUTPUT);
  let drift = false;
  if (options.write) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, rendered, 'utf8');
  } else {
    const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
    drift = current !== rendered;
  }

  const verdict = drift ? INCOMPLETE : PREPARED_VERDICT;
  const exitCode = drift ? 84 : 0;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ verdict, exitCode, drift }, null, 2)}\n`);
    return exitCode;
  }

  if (drift) {
    process.stderr.write(
      `⛔ ${verdict}: ${ROYAL_DECISION_ERRORS.PACKET_DRIFT}: ${OUTPUT} منزاحٌ عن العقدِ.\n`,
    );
  }

  const lines = [];
  lines.push('═══ حزمة القرار الملكي (M11.09) — تجهيز لا قرار ═══');
  lines.push('');
  lines.push(`الوثيقةُ: ${OUTPUT}`);
  if (drift) {
    lines.push('');
    lines.push(
      `⛔ ${ROYAL_DECISION_ERRORS.PACKET_DRIFT}: الوثيقةُ المُقيَّدةُ منزاحةٌ عن العقدِ — شغِّلْ \`npm run royal:packet\`.`,
    );
  }
  lines.push('');
  lines.push(
    verdict === PREPARED_VERDICT
      ? '✅ الحكمُ: royal-decision:prepared — الحزمةُ مُجهَّزةٌ وحقولُ القرارِ فارغةٌ. **ولا قرارَ صدرَ: `M11.09` تبقى ⬜ و`G11` تبقى مؤجَّلةً.**'
      : `⛔ الحكمُ: ${verdict}`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return exitCode;
}

process.exitCode = main();
