#!/usr/bin/env node
/**
 * **حاجزُ العقدِ المنشورِ** — `WL-194`، إغلاقُ `D-2`.
 *
 * **علّةُ وجودِه:** العقدُ في `docs/API_CONTRACT.json` ملفٌّ مُقيَّدٌ في المستودعِ
 * يقرأُه **مستهلِكٌ خارجَ العقدِ الداخليِّ**. وملفٌّ مُقيَّدٌ يُولَّدُ مرّةً ثمّ
 * يُنسى **يكذبُ بصمتٍ**: يُضافُ مسارٌ أو يُغيَّرُ رمزُ رفضٍ أو تُبدَّلُ ترويسةٌ،
 * فيبقى العقدُ يَعِدُ بما لا يُخدَمُ. **ووعدٌ لا يُخدَمُ أسوأُ من غيابِ عقدٍ**، لأنّ
 * العميلَ يُبنى عليه ويُرَدُّ برموزٍ لا يعرفُها.
 *
 * **والمقياسُ إعادةُ توليدٍ ومقارنةٌ بايتاً ببايتٍ** — كما في `guard:readiness` —
 * لا فحصُ وجودٍ ولا فحصُ حقولٍ منتقاةٍ: حاجزٌ يفحصُ الوجودَ ولا يفحصُ الصحّةَ ليس
 * حاجزاً. وقواعدُه أربعٌ:
 *
 *   R1: الملفُّ المُعلَنُ في `config/api.yaml` (‏`wire.contract.file`) موجودٌ.
 *   R2: نصُّه **مطابقٌ بايتاً ببايتٍ** للمُولَّدِ من الحقيقةِ الراهنةِ.
 *   R3: المولِّدُ المُعلَنُ في الوثيقةِ (‏`wire.contract.generatedBy`) موجودٌ فعلاً،
 *       وهذا الحاجزُ مُعلَنٌ في العقدِ باسمِه — فعقدٌ لا يقولُ مَن يحرسُه لا يُحرَسُ.
 *   R4: **لا مادّةَ مفتاحٍ خاصٍّ في العقدِ**: لا لفظَ `PRIVATE KEY` ولا `BEGIN`،
 *       فعقدٌ يحملُ سرّاً عقدٌ يُسرِّبُه إلى كلِّ قارئٍ.
 *
 * رموزُ الخروجِ: 0 مطابقٌ، 1 منزاحٌ أو مفقودٌ، 2 خللٌ في التحميلِ.
 *
 * والاستعمالُ: `node scripts/guard-api-contract.mjs [--root <dir>]` — و`--root`
 * لأجلِ **قياسِ الحاجزِ نفسِه** على جذورٍ مصنوعةٍ: حاجزٌ لا يُقاسُ حكمُه لا يُوثَقُ به.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { loadApiPolicy } from '../src/api/index.mjs';
import { renderApiContract } from './api-contract.mjs';

const GUARD_PATH = 'scripts/guard-api-contract.mjs';

/**
 * @param {{ root?: string }} [options]
 * @returns {{ ok: boolean, failures: string[] }}
 */
export function inspectApiContract(options = {}) {
  /** @type {string[]} */
  const failures = [];
  const root = options.root ?? process.cwd();
  const configDir = path.join(root, 'config');
  const policy = loadApiPolicy({ dir: configDir });
  const relative = policy.wire.contract.file;
  const target = path.join(root, relative);
  const generator = path.join(root, policy.wire.contract.generatedBy);

  if (!fs.existsSync(generator)) {
    failures.push(
      `R3: المولِّدُ المُعلَنُ «${policy.wire.contract.generatedBy}» غيرُ موجودٍ؛ وإعلانٌ لمولِّدٍ غائبٍ إعلانٌ لا يُنفَّذُ.`,
    );
  }
  if (!fs.existsSync(target)) {
    failures.push(
      `R1: العقدُ المُعلَنُ «${relative}» غيرُ موجودٍ؛ ومستهلِكٌ خارجيٌّ بلا عقدٍ منشورٍ يقرأُ الشفرةَ أو يُخمِّنُ.`,
    );
    return { ok: failures.length === 0, failures };
  }

  const actual = fs.readFileSync(target, 'utf8');
  const expected = renderApiContract({ dir: configDir });
  if (actual !== expected) {
    const actualLines = actual.split('\n');
    const expectedLines = expected.split('\n');
    const limit = Math.max(actualLines.length, expectedLines.length);
    let firstDiff = -1;
    for (let index = 0; index < limit; index += 1) {
      if (actualLines[index] !== expectedLines[index]) {
        firstDiff = index + 1;
        break;
      }
    }
    failures.push(
      `R2: «${relative}» منزاحٌ عن الحقيقةِ الراهنةِ (‏أوّلُ اختلافٍ في السطرِ ${firstDiff}). ` +
        `أعِدْ توليدَه: \`node ${policy.wire.contract.generatedBy}\`.`,
    );
  }

  /** @type {Record<string, unknown>} */
  let parsed;
  try {
    parsed = JSON.parse(actual);
  } catch {
    failures.push(`R2: «${relative}» ليس JSON صالحاً؛ وعقدٌ لا يُقرأُ آلياً ليس عقداً منشوراً.`);
    return { ok: failures.length === 0, failures };
  }
  if (parsed['guard'] !== GUARD_PATH) {
    failures.push(
      `R3: العقدُ لا يُعلِنُ حاجزَه «${GUARD_PATH}»؛ وعقدٌ لا يقولُ مَن يحرسُه لا يُحرَسُ.`,
    );
  }
  if (actual.includes('PRIVATE KEY') || actual.includes('-----BEGIN')) {
    failures.push(
      `R4: «${relative}» يحملُ ما يُشبِهُ مادّةَ مفتاحٍ؛ والعقدُ يُعلَنُ للجميعِ فما فيه ليس سرّاً بحالٍ.`,
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * @param {readonly string[]} [argv]
 * @returns {number}
 */
export function run(argv = []) {
  const at = argv.indexOf('--root');
  const root = at === -1 ? process.cwd() : (argv[at + 1] ?? process.cwd());
  /** @type {{ ok: boolean, failures: string[] }} */
  let verdict;
  try {
    verdict = inspectApiContract({ root });
  } catch (error) {
    process.stdout.write(
      `حاجزُ العقدِ المنشورِ: تعذَّرَ الفحصُ — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }
  if (verdict.ok) {
    process.stdout.write('حاجزُ العقدِ المنشورِ: مطابقٌ للحقيقةِ الراهنةِ.\n');
    return 0;
  }
  process.stdout.write('حاجزُ العقدِ المنشورِ: انزياحٌ مقيسٌ —\n');
  for (const failure of verdict.failures) process.stdout.write(`  - ${failure}\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run(process.argv.slice(2)));
}
