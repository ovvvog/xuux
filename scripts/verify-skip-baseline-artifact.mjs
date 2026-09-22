#!/usr/bin/env node
// المُتحقِّقُ الموثوقُ من أثرِ خطِّ أساسِ التخطّي — **يَقرأُ ويَحكُمُ ولا يَكتُبُ**.
//
// **لماذا مُتحقِّقٌ ولا إعادةُ تشغيلٍ للمولِّدِ (‏`OPS-1`):** `measure-skip-baseline.mjs`
// **مولِّدٌ** لا مُتحقِّقٌ: يَلزَمُهُ مُخرَجُ TAP ويَكتُبُ بـ`writeFileSync`. فإعادتُهُ في
// مرحلةِ النشرِ تَقتضي إعادةَ تشغيلِ الحزمةِ كلِّها (ثلاثينَ دقيقةً) أو تمريرَ TAP الذي
// أنتجَتْهُ **الشجرةُ المقاسةُ نفسُها** — فلا تُضيفُ ثقةً وتُضيفُ كلفةً. والحكمُ في
// النشرِ يجبُ أن يكونَ بكودِ `main` وحدَهُ، **وهذا هوَ ذلكَ الكودُ**.
//
// **وما لا يَقدِرُ عليهِ هذا المُتحقِّقُ مُعلَنٌ لا مستورٌ:** عدّاداتُ TAP
// (`tests`/`pass`/`fail`/`skipped`) **لا تُتحقَّقُ هنا** — إنتاجُها يَقتضي تنفيذَ كودِ
// الشجرةِ المقاسةِ، ولا سبيلَ إلى تكذيبِ عدّادٍ بلا إعادةِ تشغيلِ الحزمةِ. والمُعوِّضُ
// **عقديٌّ لا تجزيئيٌّ**: `V4` يُثبِتُ أنَّ المقاسَ رأسُ `main`، وشجرةُ `main` موثوقةٌ
// بالتعريفِ. فحَصْرُ ما يُقاسُ هوَ ما يُعطي العدّاداتَ معناها — لا بصمةٌ على ملفٍّ.
//
// **والـdigest يُثبِتُ النقلَ لا الأصالةَ:** `V1` يُثبِتُ أنَّ الملفَّ المُنزَّلَ هوَ
// المرفوعُ، ولا يُثبِتُ صدقَ أرقامِهِ. ولا مَخطوطةَ digest تَجعلُ محتوىً من كودٍ غيرِ
// موثوقٍ موثوقاً — وذاكَ تصحيحٌ صريحٌ لِزَعمٍ سابقٍ في التصميمِ الأوّلِ.
//
// **الاستعمالُ:**
//   node scripts/verify-skip-baseline-artifact.mjs \
//     --artifact <path/to/downloaded/skip-baseline.json> \
//     --artifact-sha256 <hex64> \
//     --measured-sha <sha40> --main-head-at-measure <sha40> \
//     --trusted-root . [--main-ref refs/remotes/origin/main]

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { computeScopeDigest, scopeDiff } from './lib/skip-baseline-scope.mjs';

/** العقدُ المقبولُ للنشرِ — **لا يُنشَرُ أثرٌ دونَهُ** (`V7`). */
export const REQUIRED_CONTRACT_VERSION = 2;

/** الأحكامُ المقبولةُ وحدَها (`V6`). */
export const ALLOWED_VERDICTS = new Set(['success', 'self-stale-only']);

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const INT_FIELDS = [
  'tests',
  'pass',
  'fail',
  'skipped',
  'skipLines',
  'topLevelSkipPoints',
  'attributedToDatabaseUrl',
  'testFileCount',
];

const STRING_FIELDS = [
  'engagement',
  'plan',
  'command',
  'commit',
  'mainHeadAtMeasure',
  'scopeDigest',
  'measuredOn',
  'verdict',
];

/**
 * يُطبِّقُ التحقُّقاتِ السبعةَ ويُعيدُ الرفضَ **برمزِهِ** — دالّةٌ نقيّةٌ ليَقرأَها الاختبارُ.
 *
 * ولا تَرمي على أوّلِ رفضٍ بل تَجمعُ: رفضٌ واحدٌ يُخفي أخاهُ يَدفعُ المنفِّذَ إلى
 * إصلاحٍ جزئيٍّ ثمَّ تشغيلةٍ أخرى، وثلاثونَ دقيقةً لكلِّ تشغيلةٍ.
 *
 * @param {{
 *   artifactText: string,
 *   expectedArtifactSha256: string,
 *   measuredSha: string,
 *   mainHeadAtMeasure: string,
 *   trustedRoot: string,
 *   mainRef?: string,
 * }} input
 * @returns {{ rejections: string[], mainHeadAtPublish: string | null, entryCount: number }}
 */
export function verifyArtifact(input) {
  const {
    artifactText,
    expectedArtifactSha256,
    measuredSha,
    mainHeadAtMeasure,
    trustedRoot,
    mainRef = 'refs/remotes/origin/main',
  } = input;
  /** @type {string[]} */
  const rejections = [];

  // ── V1 · سلامةُ النقلِ ──
  if (!SHA256.test(expectedArtifactSha256)) {
    rejections.push(
      `VERIFY_ARTIFACT_DIGEST_MISMATCH: البصمةُ المتوقَّعةُ ليسَت sha256 صالحةً: ${expectedArtifactSha256}`,
    );
  } else {
    const actual = createHash('sha256').update(artifactText, 'utf8').digest('hex');
    if (actual !== expectedArtifactSha256) {
      rejections.push(
        `VERIFY_ARTIFACT_DIGEST_MISMATCH: بصمةُ الأثرِ المُنزَّلِ ${actual} والمتوقَّعةُ ${expectedArtifactSha256} — نقلٌ غيرُ سليمٍ أو تبديلٌ بعدَ الرفعِ.`,
      );
    }
  }

  if (!SHA40.test(measuredSha) || !SHA40.test(mainHeadAtMeasure)) {
    rejections.push(
      `VERIFY_SHAPE_INVALID: --measured-sha و--main-head-at-measure يجبُ أن يكونا بصمتَينِ كاملتَينِ.`,
    );
    return { rejections, mainHeadAtPublish: null, entryCount: 0 };
  }

  // ── V4 · عقدُ رأسِ main — قبلَ كلِّ شيءٍ آخرَ يَعتمِدُ عليهِ ──
  if (measuredSha !== mainHeadAtMeasure) {
    rejections.push(
      `VERIFY_NOT_MAIN_HEAD: المقاسُ ${measuredSha} ورأسُ main عندَ القياسِ ${mainHeadAtMeasure} — عقدُ القياسِ رأسُ main وحدَهُ.`,
    );
  }

  // ── V7 · الشكلُ والعقدُ ──
  /** @type {any} */
  let artifact;
  try {
    artifact = JSON.parse(artifactText);
  } catch (err) {
    rejections.push(
      `VERIFY_SHAPE_INVALID: الأثرُ لا يُقرأُ JSON — ${/** @type {Error} */ (err).message}`,
    );
    return { rejections, mainHeadAtPublish: null, entryCount: 0 };
  }
  if (artifact?.contractVersion !== REQUIRED_CONTRACT_VERSION) {
    rejections.push(
      `VERIFY_SHAPE_INVALID: contractVersion = ${JSON.stringify(artifact?.contractVersion)} والمطلوبُ ${REQUIRED_CONTRACT_VERSION} — أثرٌ بلا عقدِ هويّةٍ لا يُنشَرُ.`,
    );
  }
  const entries = Array.isArray(artifact?.measurements) ? artifact.measurements : null;
  if (!entries || entries.length === 0) {
    rejections.push(`VERIFY_SHAPE_INVALID: الأثرُ بلا مُدخلاتِ قياسٍ.`);
    return { rejections, mainHeadAtPublish: null, entryCount: 0 };
  }

  for (const [i, e] of entries.entries()) {
    for (const f of STRING_FIELDS) {
      if (typeof e?.[f] !== 'string' || e[f].length === 0) {
        rejections.push(`VERIFY_SHAPE_INVALID: المُدخلةُ ${i} بلا حقلٍ نصّيٍّ \`${f}\`.`);
      }
    }
    for (const f of INT_FIELDS) {
      if (!Number.isInteger(e?.[f]) || e[f] < 0) {
        rejections.push(
          `VERIFY_SHAPE_INVALID: المُدخلةُ ${i} حقلُها \`${f}\` ليسَ عدداً صحيحاً غيرَ سالبٍ.`,
        );
      }
    }
    // ── V6 · الحكمُ ──
    if (typeof e?.verdict === 'string' && !ALLOWED_VERDICTS.has(e.verdict)) {
      rejections.push(
        `VERIFY_VERDICT_UNKNOWN: المُدخلةُ ${i} حكمُها \`${e.verdict}\` وليسَ من ${[...ALLOWED_VERDICTS].join('|')}.`,
      );
    }
    // ── V2 · هويّةُ الكوميتِ — لكلِّ مُدخلةٍ لا لواحدةٍ ──
    if (typeof e?.commit === 'string' && e.commit !== measuredSha) {
      rejections.push(
        `VERIFY_COMMIT_MISMATCH: المُدخلةُ ${i} كوميتُها ${e.commit} والمقاسُ في التشغيلةِ ${measuredSha}.`,
      );
    }
    // ── V3 · رأسُ main عندَ القياسِ ──
    if (typeof e?.mainHeadAtMeasure === 'string' && e.mainHeadAtMeasure !== mainHeadAtMeasure) {
      rejections.push(
        `VERIFY_MAIN_HEAD_MISMATCH: المُدخلةُ ${i} تقولُ رأسَ main ${e.mainHeadAtMeasure} والتشغيلةُ ${mainHeadAtMeasure}.`,
      );
    }
  }

  // ── V5 · `I5` — هل تحرَّكَ نطاقُ main بينَ القياسِ والنشرِ؟ ──
  // **هذا هوَ جوابُ لحظةِ السباقِ، ولا يَعتمِدُ على `R6` ولا على `R7`:** يُقرأُ
  // `origin/main` **الآنَ** وتُحسَبُ بصمةُ نطاقِهِ وتُقابَلُ ببصمةِ الأثرِ. فدمجٌ
  // وقعَ في `main` بعدَ اكتمالِ القياسِ يَمنعُ النشرَ هنا — لا يُكتشَفُ بعدَهُ.
  /** @type {string} */
  let mainHeadAtPublish;
  try {
    mainHeadAtPublish = execFileSync('git', ['-C', trustedRoot, 'rev-parse', '--verify', mainRef], {
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    rejections.push(
      `PUBLISH_SCOPE_DRIFT: لا يُقرأُ ${mainRef} في ${trustedRoot} — لا مادّةَ للتحقُّقِ، فلا نشرَ. ${/** @type {Error} */ (err).message}`,
    );
    return { rejections, mainHeadAtPublish: null, entryCount: entries.length };
  }
  /** @type {string | null} */
  let publishScopeDigest = null;
  try {
    publishScopeDigest = computeScopeDigest(trustedRoot, mainHeadAtPublish);
  } catch (err) {
    rejections.push(
      `PUBLISH_SCOPE_DRIFT: لا تُحسَبُ بصمةُ نطاقِ ${mainRef} — ${/** @type {Error} */ (err).message}`,
    );
  }
  if (publishScopeDigest !== null) {
    for (const [i, e] of entries.entries()) {
      if (typeof e?.scopeDigest !== 'string') continue;
      if (e.scopeDigest !== publishScopeDigest) {
        /** @type {string[]} */
        let differing;
        try {
          differing = scopeDiff(trustedRoot, measuredSha, mainHeadAtPublish);
        } catch {
          differing = ['(لا يُحسَبُ الفرقُ — الكوميتُ المقاسُ غيرُ مجلوبٍ في هذا الجذرِ)'];
        }
        rejections.push(
          `PUBLISH_SCOPE_DRIFT: المُدخلةُ ${i} قِيسَت على نطاقٍ ببصمةِ ${e.scopeDigest.slice(0, 12)} ورأسُ main الآنَ ${mainHeadAtPublish.slice(0, 8)} ببصمةِ ${publishScopeDigest.slice(0, 12)} — تحرَّكَ main بينَ القياسِ والنشرِ. المساراتُ المختلفةُ: ${differing.join(' · ') || '(لا شيءَ — تعارضٌ يَستحقُّ فحصاً)'}. أَعِدِ القياسَ على رأسِ main الجديدِ.`,
        );
      }
    }
  }

  return { rejections, mainHeadAtPublish, entryCount: entries.length };
}

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseFlags(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      process.stderr.write(`⛔ الوسيطُ ${a} بلا قيمةٍ.\n`);
      process.exit(1);
    }
    flags[a.slice(2)] = next;
    i += 1;
  }
  return flags;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  for (const required of [
    'artifact',
    'artifact-sha256',
    'measured-sha',
    'main-head-at-measure',
    'trusted-root',
  ]) {
    if (!flags[required]) {
      process.stderr.write(`⛔ يلزمُ الوسيطُ --${required}.\n`);
      process.exit(1);
    }
  }
  /** @type {string} */
  let artifactText;
  try {
    artifactText = readFileSync(String(flags.artifact), 'utf8');
  } catch (err) {
    process.stderr.write(
      `⛔ VERIFY_ARTIFACT_UNREADABLE: ${flags.artifact} — ${/** @type {Error} */ (err).message}\n`,
    );
    process.exit(1);
    return;
  }
  const { rejections, mainHeadAtPublish, entryCount } = verifyArtifact({
    artifactText,
    expectedArtifactSha256: String(flags['artifact-sha256']),
    measuredSha: String(flags['measured-sha']),
    mainHeadAtMeasure: String(flags['main-head-at-measure']),
    trustedRoot: String(flags['trusted-root']),
    ...(flags['main-ref'] ? { mainRef: String(flags['main-ref']) } : {}),
  });
  if (rejections.length > 0) {
    process.stderr.write('⛔ المُتحقِّقُ رَدَّ الأثرَ — لا نشرَ.\n');
    for (const r of rejections) process.stderr.write(`   - ${r}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `✅ الأثرُ مُتحقَّقٌ منهُ: ${entryCount} مُدخلةً · العقدُ ${REQUIRED_CONTRACT_VERSION} · المقاسُ ${String(flags['measured-sha']).slice(0, 8)} · رأسُ main عندَ النشرِ ${String(mainHeadAtPublish).slice(0, 8)}\n` +
      `   وحدٌّ مُعلَنٌ: عدّاداتُ TAP لم تُتحقَّقْ هنا — إنتاجُها يَقتضي تنفيذَ كودِ الشجرةِ المقاسةِ. والمُعوِّضُ أنَّ المقاسَ رأسُ main (V4).\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
