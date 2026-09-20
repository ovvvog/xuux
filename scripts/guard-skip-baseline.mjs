#!/usr/bin/env node
// حاجزُ خطِّ أساسِ التخطّي — كلُّ عددِ تخطٍّ مُعلَنٍ في وثيقةِ مراجعةٍ **مقيسٌ ومنسوبٌ**.
//
// **لماذا:** النتيجةُ `R5-A-06` (مجلسُ `M11.05`، تقريرُ `R5-A-01`، شدّةٌ منخفضةٌ): خطّةُ
// الجولةِ أعلنَت «بلا `DATABASE_URL` تتخطّى الحزمةُ ١٢١ اختباراً» — رقماً صحيحاً حينَ
// قِيسَ (`WL-139`، الحزمةُ 1857 اختباراً) **ووُصِفَ بأنّه «ثابتٌ»**. فنمَتِ الحزمةُ ولم
// ينمُ الرقمُ، وصارَ عضوُ المجلسِ يقرأُ في العقدِ عدداً لا يُطابقُ تشغيلتَه. وخلطٌ ثانٍ
// معهُ: نُسِبَ **كلُّ** التخطّي إلى `DATABASE_URL` وليسَ كذلك.
//
// **القواعدُ:**
//   - R1: أثرُ القياسِ موجودٌ ويُقرأُ، وكلُّ مُدخلةٍ بحقولِها وأنواعِها.
//   - R2: كلُّ مُدخلةٍ تُشيرُ إلى ملفِّ خطّةٍ موجودٍ، ولكلِّ ملفِّ خطّةٍ مُدخلةٌ واحدةٌ لا أكثرُ.
//   - R3: كلُّ وثيقةٍ في `docs/external-review/` تُعلِنُ عددَ تخطٍّ **لها مُدخلةُ قياسٍ**.
//   - R4: العددُ المُعلَنُ في الوثيقةِ يُطابقُ `attributedToDatabaseUrl` من الأثرِ —
//     لا `skipped` ولا `skipLines`، فالجملةُ تنسبُ التخطّي إلى `DATABASE_URL` نصّاً.
//   - R5: الوثيقةُ تُسمّي **الأمرَ** و**الكوميتَ** الذي قِيسَ عليهما — فقياسٌ بلا نسبةٍ زمنيّةٍ يَبلى صامتاً.
//   - R6: الأثرُ يُقابَلُ **بالواقعِ** لا بالوثيقةِ وحدَها — فكوميتُ الأثرِ يُقابَلُ برأسِ الشجرةِ،
//     وأثرٌ قِيسَ على كوميتٍ سابقٍ ثمَّ نمَتِ الحزمةُ بعدَهُ يَسقُطُ لا يَمُرُّ أخضرَ (LIVE-15).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ARTIFACT = 'docs/external-review/skip-baseline.json';
const REVIEW_DIR = 'docs/external-review';

/** نمطُ الجملةِ المُعلِنةِ — بالأرقامِ العربيّةِ الشرقيّةِ أو الغربيّةِ. */
const DECLARATION = /تتخطّى الحزمةُ ([\d٠-٩]+) اختباراً/g;

/**
 * يُحوِّلُ الأرقامَ العربيّةَ الشرقيّةَ إلى غربيّةٍ.
 * @param {string} s
 * @returns {string}
 */
export function normalizeDigits(s) {
  return s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/**
 * يَجمعُ ملفّاتِ `.md` في مجلَّدِ المراجعةِ (‏المستوى الأعلى وحدَه — الخُطَطُ فيه).
 * @param {string} root
 * @returns {string[]}
 */
function reviewDocs(root) {
  const dir = path.join(root, REVIEW_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => `${REVIEW_DIR}/${e.name}`)
    .sort();
}

/**
 * يُشغِّلُ القواعدَ ويُعيدُ قائمةَ الانتهاكاتِ — دالّةٌ نقيّةٌ ليقرأَها الاختبارُ.
 * @param {string} root
 * @param {string | null} [headCommit] — رأسُ الشجرةِ لقاعدةِ R6 (يُمرَّرُ من main أو من الاختبارِ).
 * @returns {{ violations: string[], entryCount: number, docCount: number }}
 */
export function checkSkipBaseline(root, headCommit) {
  /** @type {string[]} */
  const violations = [];
  const artifactPath = path.join(root, ARTIFACT);

  // ── R1 ──
  if (!existsSync(artifactPath)) {
    return {
      violations: [
        `R1/MISSING: أثرُ القياسِ ${ARTIFACT} غيرُ موجودٍ — وَلِّدْه بـ\`npm run measure:skip-baseline\`.`,
      ],
      entryCount: 0,
      docCount: 0,
    };
  }
  /** @type {any} */
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err) {
    return {
      violations: [
        `R1/UNREADABLE: ${ARTIFACT} لا يُقرأُ JSON — ${/** @type {Error} */ (err).message}`,
      ],
      entryCount: 0,
      docCount: 0,
    };
  }
  const entries = Array.isArray(artifact?.measurements) ? artifact.measurements : null;
  if (!entries) {
    return {
      violations: [`R1/SHAPE: ${ARTIFACT} بلا مصفوفةِ \`measurements\`.`],
      entryCount: 0,
      docCount: 0,
    };
  }

  const intFields = [
    'tests',
    'pass',
    'fail',
    'skipped',
    'skipLines',
    'topLevelSkipPoints',
    'attributedToDatabaseUrl',
  ];
  /** @type {Map<string, any>} */
  const byPlan = new Map();
  for (const [i, e] of entries.entries()) {
    for (const f of ['engagement', 'plan', 'command', 'commit', 'measuredOn']) {
      if (typeof e?.[f] !== 'string' || e[f].length === 0) {
        violations.push(`R1/FIELD: المُدخلةُ ${i} بلا حقلٍ نصّيٍّ \`${f}\`.`);
      }
    }
    for (const f of intFields) {
      if (!Number.isInteger(e?.[f]) || e[f] < 0) {
        violations.push(`R1/FIELD: المُدخلةُ ${i} حقلُها \`${f}\` ليسَ عدداً صحيحاً غيرَ سالبٍ.`);
      }
    }
    if (typeof e?.plan === 'string') {
      // ── R2 ──
      if (!existsSync(path.join(root, e.plan))) {
        violations.push(`R2/MISSING: المُدخلةُ ${i} تُشيرُ إلى خطّةٍ غيرِ موجودةٍ: ${e.plan}`);
      }
      if (byPlan.has(e.plan)) {
        violations.push(`R2/DUPLICATE: مُدخلتانِ لخطّةٍ واحدةٍ: ${e.plan}`);
      } else {
        byPlan.set(e.plan, e);
      }
    }
    if (Number.isInteger(e?.attributedToDatabaseUrl) && Number.isInteger(e?.skipped)) {
      if (e.attributedToDatabaseUrl > e.skipped) {
        violations.push(
          `R1/SANITY: المُدخلةُ ${i} تنسبُ إلى DATABASE_URL ${e.attributedToDatabaseUrl} وهو أكبرُ من عدّادِ التخطّي ${e.skipped}.`,
        );
      }
    }
  }

  // ── R3 · R4 · R5 ──
  const docs = reviewDocs(root);
  let declaring = 0;
  for (const rel of docs) {
    const text = readFileSync(path.join(root, rel), 'utf8');
    const found = [...text.matchAll(DECLARATION)];
    if (found.length === 0) continue;
    declaring += 1;
    const entry = byPlan.get(rel);
    if (!entry) {
      violations.push(
        `R3/UNMEASURED: ${rel} يُعلِنُ عددَ تخطٍّ بلا مُدخلةِ قياسٍ في ${ARTIFACT} — رقمٌ مكتوبٌ بيدٍ (R5-A-06).`,
      );
      continue;
    }
    const declared = found.map((m) => Number(normalizeDigits(m[1] ?? '')));
    const expected = entry.attributedToDatabaseUrl;
    for (const d of declared) {
      if (d !== expected) {
        violations.push(
          `R4/DRIFT: ${rel} يُعلِنُ ${d} اختباراً متخطّىً بسببِ DATABASE_URL والقياسُ ${expected} (عدّادُ التخطّي الكلّيُّ ${entry.skipped}).`,
        );
      }
    }
    const normalized = normalizeDigits(text);
    if (!normalized.includes(entry.command)) {
      violations.push(`R5/NO-COMMAND: ${rel} لا يُسمّي الأمرَ الذي قِيسَ به: \`${entry.command}\``);
    }
    if (!normalized.includes(entry.commit.slice(0, 8))) {
      violations.push(
        `R5/NO-COMMIT: ${rel} لا يُسمّي الكوميتَ الذي قِيسَ عليه: ${entry.commit.slice(0, 8)}`,
      );
    }
  }

  // ── R6 · تقادُمُ الأثرِ ──
  // الأثرُ يُقابَلُ بالواقعِ لا بالوثيقةِ وحدَها: كوميتُ الأثرِ يُقابَلُ برأسِ الشجرةِ،
  // فأثرٌ قِيسَ على كوميتٍ سابقٍ ثمَّ نمَتِ الحزمةُ بعدَهُ يَسقُطُ لا يَمُرُّ أخضرَ (LIVE-15).
  if (headCommit) {
    for (const [i, e] of entries.entries()) {
      if (typeof e?.commit === 'string' && e.commit !== headCommit) {
        violations.push(
          `R6/STALE: المُدخلةُ ${i} قِيسَت على كوميتٍ ${e.commit.slice(0, 8)} ورأسُ الشجرةِ ${headCommit.slice(0, 8)} — القياسُ متقادِمٌ، أَعِدْه بـ\`npm run measure:skip-baseline\`.`,
        );
      }
    }
  }

  return { violations, entryCount: entries.length, docCount: declaring };
}

function main() {
  const root = process.cwd();
  let headCommit = null;
  try {
    headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // ليسَ مستودعَ git — تُخطَّى R6
  }
  const { violations, entryCount, docCount } = checkSkipBaseline(root, headCommit);
  if (violations.length > 0) {
    process.stderr.write('⛔ حاجزُ خطِّ أساسِ التخطّي: عددٌ مُعلَنٌ غيرُ مقيسٍ أو غيرُ منسوبٍ.\n');
    for (const v of violations) process.stderr.write(`   - ${v}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `✅ حاجزُ خطِّ أساسِ التخطّي: ${entryCount} مُدخلةَ قياسٍ و${docCount} وثيقةً مُعلِنةً — كلُّ عددٍ مُعلَنٍ مقيسٌ ومنسوبٌ إلى أمرِه وكوميتِه${headCommit ? ` ورأسِ شجرتِه` : ''}.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
