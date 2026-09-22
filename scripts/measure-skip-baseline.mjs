#!/usr/bin/env node
// مقياسُ خطِّ أساسِ التخطّي — يُولَّدُ من مُخرَجِ TAP حقيقيٍّ، ولا يُكتَبُ بيدٍ.
//
// **لماذا هذا الملفُّ:** النتيجةُ `R5-A-06` من مجلسِ `M11.05` كشفَت أنَّ خطّةَ الجولةِ
// أعلنَت «تتخطّى الحزمةُ ١٢١ اختباراً» رقماً **مكتوباً بيدٍ** ووُصِفَ بأنّه «ثابتٌ»
// (‏`WL-139`) — فلمّا نمَتِ الحزمةُ صارَ الرقمُ لا يُطابقُ أيَّ تشغيلةٍ. والعلّةُ ليست
// في الرقمِ بل في **كتابةِ قياسٍ بيدٍ بلا أمرٍ يُنتِجُه ولا كوميتٍ يُنسَبُ إليه**.
// فصارَ الرقمُ يُولَّدُ من مُخرَجِ TAP بهذا الأمرِ، ويحرسُه `guard:skip-baseline`.
//
// **الاستعمالُ (عقدُ الهويّةِ · `OPS-1` · `WL-246`):**
//   node scripts/measure-skip-baseline.mjs <tap> \
//     --engagement M11.05 --plan docs/external-review/M11.05-round-1-plan.md \
//     --command 'env -u DATABASE_URL npm test' \
//     --measured-root ./measured --artifact-root . \
//     --expect-commit <sha40> --expect-main-head <sha40> --test-exit 0
//
// **ولماذا حُذِفَ `--commit` (‏`OPS-1`):** كانَ يُكتَبُ في الأثرِ **بلا تحقُّقٍ**
// (`flags.commit ?? git rev-parse HEAD`)، فأيُّ نصٍّ يُمرَّرُ يُنسَبُ إليه قياسٌ لم
// يَقَعْ عليه — ومنه تُشتَقُّ نسبةُ التخطّي المُعلَنةُ في وثائقِ الخطّةِ (`R4`/`R5`).
// **والحقلُ اليومَ مُشتَقٌّ لا مُمَرَّرٌ:** يُقرأُ من رأسِ `--measured-root`،
// ويُقابَلُ بـ`--expect-commit` توكيداً (`A2`)، وتُفحَصُ نظافةُ الشجرةِ (`A3`)
// فلا يُنسَبُ كوميتٌ إلى شجرةٍ عُدِّلَت بعدَ استخراجِها.
//
// **وجذرانِ لا جذرٌ واحدٌ:** `--measured-root` **تُقرأُ ولا يُكتَبُ فيها** — وهيَ
// شجرةُ الكودِ المقاسِ، تُعامَلُ **بياناتٍ** لا برنامجاً. و`--artifact-root` هيَ
// الشجرةُ الموثوقةُ (من `main`) التي يُكتَبُ فيها الأثرُ. و`process.cwd()` لا
// يُستعمَلُ — فجذرٌ ضمنيٌّ هوَ ما جَعَلَ الأداةَ تَخلِطُ المقاسَ بالموثوقِ.
//
// **ثلاثةُ مقاييسَ مختلفةٍ لا مقياسٌ واحدٌ** — وخلطُها هو نصفُ العطبِ:
//   - `skipped`: عدّادُ `# skipped` الختاميُّ من node (يَعُدُّ نقاطَ الاختبارِ المتداخلةَ).
//   - `skipLines`: كلُّ سطرٍ فيه `# SKIP` على أيِّ عمقٍ.
//   - `topLevelSkipPoints`: نقاطُ التخطّي في المستوى الأعلى وحدَها.
// ولا واحدٌ منها «عددُ ما تتخطّاهُ الحزمةُ بسببِ `DATABASE_URL`» — ذاكَ
// `attributedToDatabaseUrl` وحدَه.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { countTestFiles } from './lib/doc-count-facts.mjs';
import { computeScopeDigest } from './lib/skip-baseline-scope.mjs';

const ARTIFACT = 'docs/external-review/skip-baseline.json';

/**
 * الإصدارُ العقديُّ للأثرِ. `1` (أو غيابُهُ) أثرٌ قديمٌ بلا `scopeDigest`؛ `2`
 * أثرٌ بعقدِ الهويّةِ. والمُتحقِّقُ (`V7`) **يَرفُضُ نشرَ ما دونَ `2`**.
 */
export const CONTRACT_VERSION = 2;

/** شكلُ مُعرِّفِ الكوميتِ المقبولِ وحدَهُ: بصمةٌ كاملةٌ أربعونَ محرفاً. */
export const SHA40 = /^[0-9a-f]{40}$/;

/** @param {string} s */
function fail(s) {
  process.stderr.write(`⛔ ${s}\n`);
  process.exit(1);
}

/**
 * يُصنِّفُ إخفاقاتِ TAP: أيُّها ذاتيٌّ مرجعيٌّ (R6/STALE من حاجزِ skip-baseline)
 * وأيُّها إخفاقٌ آخرُ. **الجُمودُ الذي يَكسِرُهُ هذا التصنيفُ (LIVE-16):**
 * R6/STALE يَسقُطُ حينَ تنمو الشجرةُ بملفِّ اختبارٍ، فيَسقُطُ اختبارُ الحاجزِ،
 * فيَرفُضُ المقياسُ التشغيلةَ (fail ≠ 0)، فلا يُحدَّثُ الأثرُ، فيَبقى الحاجزُ
 * ساقطاً — جُمودٌ تامٌّ. هذا التصنيفُ يُميِّزُ الإخفاقَ الذاتيَّ المرجعيَّ
 * بعينِهِ فيَسمَحُ بتحديثِ الأثرِ **إذا كانَ الإخفاقُ الوحيدُ** هو تقادُمُ الأثرِ
 * نفسِهِ — لا بإلغاءِ شرطِ «لا خطَّ أساسٍ من تشغيلةٍ فاشلةٍ» (ذاكَ إرخاءٌ)،
 * بل بتمييزِ إخفاقٍ بعينِهِ يَعودُ سببُهُ إلى الأثرِ نفسِهِ لا إلى الشفرةِ.
 *
 * **كيفَ يُميِّزُ:** كلُّ كتلةِ إخفاقٍ (not ok + diagnostic) يُفحَصُ نصُّها — إنِ
 * احتوى على `R6/STALE` وكانَ سياقُ `skip-baseline` حاضراً، فهوَ إخفاقٌ ذاتيٌّ.
 * وإنِ احتوى على أيِّ إخفاقٍ آخرَ، فهوَ إخفاقٌ أجنبيٌّ يُرَدُّ.
 *
 * @param {string} tapText
 * @returns {{ selfStale: number, other: number, total: number, detail: string[] }}
 */
export function classifyFailures(tapText) {
  const lines = tapText.split('\n');
  /** @type {{ name: string, diagnostic: string }[]} */
  const failedBlocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    // كتلةُ إخفاقٍ: not ok في أيِّ عمقٍ (بمسافةٍ بادئةٍ أو بلاها).
    const m = /^\s*not ok \d+ - (.+)$/.exec(line);
    if (m) {
      const name = m[1] ?? '';
      /** @type {string[]} */
      const diag = [];
      let j = i + 1;
      // اجمعْ كتلةَ التشخيصِ حتى ok/not ok التالي أو ملخَّصٌ ختاميٌّ.
      while (j < lines.length) {
        const d = lines[j] ?? '';
        if (/^\s*(ok|not ok) \d+/.test(d)) break;
        if (/^\s*# (tests|pass|fail|skipped|todo|duration_ms|suites|cancelled) /.test(d)) break;
        diag.push(d);
        j += 1;
      }
      // تخطَّ كتلَ الملخّصِ الأبويّةَ — تلكَ التي تَحوي tests:/pass:/fail: بلا error:.
      // هيَ تقاريرُ ملفِّ اختبارٍ فاشلٍ، لا إخفاقُ تأكيدٍ بعينِه.
      const diagText = diag.join('\n');
      if (!/error:/.test(diagText) && /^\s*(tests|pass|fail):/m.test(diagText)) {
        i = j;
        continue;
      }
      failedBlocks.push({ name, diagnostic: diagText });
      i = j;
    } else {
      i += 1;
    }
  }
  /** @type {string[]} */
  const detail = [];
  let selfStale = 0;
  let other = 0;
  for (const b of failedBlocks) {
    const text = b.name + '\n' + b.diagnostic;
    // الإخفاقُ الذاتيُّ المرجعيُّ رمزانِ لا رمزٌ واحدٌ (‏`OPS-1`): `R6/STALE`
    // يُقابِلُ عدّادَ ملفّاتِ الاختبارِ، و`R7/SCOPE-DRIFT` يُقابِلُ بصمةَ
    // نطاقِ الشجرةِ — **وكلاهما يقولُ «الأثرُ متقادِمٌ عن نفسِهِ»** لا «الشفرةُ
    // معطوبةٌ». ولو لم يُستثنَ `R7` لَعادَ جمودُ `LIVE-16` من بابٍ أدقَّ:
    // تغييرُ ملفٍ في النطاقِ يُسقِطُ الحاجزَ، فتَرفُضُ الأداةُ التشغيلةَ، فلا
    // يُحدَّثُ الأثرُ أبداً. **و`R8/BASE-DRIFT` ليسَ منهما ولا يُستثنى قطعاً**:
    // لا يقولُ «الأثرُ متقادِمٌ» بل «الأساسُ تحرَّكَ»، وعلاجُهُ إعادةُ قياسٍ لا
    // استثناءٌ — واستثناؤُهُ يفتحُ المنفَذَ الذي أُغلِقَ بـ`LIVE-16`.
    const isSelfStale =
      (text.includes('R6/STALE') || text.includes('R7/SCOPE-DRIFT')) &&
      !text.includes('R8/BASE-DRIFT') &&
      (text.includes('skip-baseline') || text.includes('guard-skip-baseline'));
    if (isSelfStale) {
      selfStale += 1;
      detail.push(`ذاتيٌّ: ${b.name.slice(0, 60)}`);
    } else {
      other += 1;
      detail.push(`أجنبيٌّ: ${b.name.slice(0, 60)}`);
    }
  }
  return { selfStale, other, total: failedBlocks.length, detail };
}

/**
 * يَحكُمُ: هل تُسمَحُ التشغيلةُ بتحديثِ الأثرِ رغمَ إخفاقِها؟
 * تُسمَحُ **فقط** إذا كانَ كلُّ إخفاقٍ ذاتيّاً مرجعيّاً (R6/STALE من skip-baseline)
 * وكانَ عددُ الكتلِ المُصنَّفةِ يُساوي عددَ الإخفاقاتِ المُعلَنِ.
 * أيُّ تبايُنٍ ⇒ مغلقٌ (فشلٌ بلا تحليلٍ، أو إخفاقٌ أجنبيٌّ، أو فجوةٌ بينَ
 * الإخفاقاتِ المُعلَنةِ والكتلِ المُحلَّلةِ).
 *
 * @param {string} tapText
 * @param {number} rawFail — عدّادُ `# fail` من TAP.
 * @returns {{ allowed: boolean, reason: string }}
 */
export function allowSelfStaleOnly(tapText, rawFail) {
  if (rawFail === 0) return { allowed: false, reason: 'لا إخفاقَ — التشغيلةُ ناجحةٌ.' };
  const cls = classifyFailures(tapText);
  if (cls.total === 0) {
    return {
      allowed: false,
      reason: `تشغيلةٌ فيها ${rawFail} إخفاقاً ولا كتلةَ إخفاقٍ قابلةٌ للتحليلِ — لا تُصلُحُ خطَّ أساسٍ.`,
    };
  }
  if (cls.other > 0) {
    return {
      allowed: false,
      reason: `تشغيلةٌ فيها ${rawFail} إخفاقاً (${cls.other} أجنبيّاً و${cls.selfStale} ذاتيّاً) لا تُصلُحُ خطَّ أساسٍ — أصلِحِ الإخفاقَ الأجنبيَّ أوّلاً.`,
    };
  }
  // فحصٌ مغلقٌ: عددُ الكتلِ الذاتيّةِ يجبُ أن يُساوي عددَ الإخفاقاتِ المُعلَنَ.
  if (cls.selfStale !== rawFail || cls.total !== rawFail) {
    return {
      allowed: false,
      reason: `تشغيلةٌ فيها ${rawFail} إخفاقاً لكنَّ المصنّفَ وَجَدَ ${cls.total} كتلةً (${cls.selfStale} ذاتيّاً) — تبايُنٌ يَمنَعُ التحديثَ.`,
    };
  }
  return {
    allowed: true,
    reason: `سُمِحَ بتحديثِ الأثرِ على تشغيلةٍ إخفاقُها الوحيدُ ذاتيٌّ مرجعيٌّ (R6/STALE من guard-skip-baseline) — LIVE-16.`,
  };
}

/**
 * يَقرأُ وسائطَ سطرِ الأمرِ بلا تبعيّةٍ خارجيّةٍ.
 * @param {string[]} argv
 * @returns {{ tap: string, flags: Record<string, string> }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        fail(`الوسيطُ --${key} بلا قيمةٍ.`);
        throw new Error('unreachable');
      }
      flags[key] = next;
      i += 1;
    } else {
      positional.push(a);
    }
  }
  const tap = positional[0];
  if (positional.length !== 1 || tap === undefined) {
    fail('يلزمُ مسارُ ملفِّ TAP واحداً بلا زيادةٍ.');
    throw new Error('unreachable');
  }
  return { tap, flags };
}

/**
 * يَستخرجُ المقاييسَ من نصِّ TAP — **قراءةٌ لا تخمينٌ**.
 * @param {string} tapText
 * @returns {{ tests: number, pass: number, fail: number, skipped: number, skipLines: number,
 *   topLevelSkipPoints: number, attributedToDatabaseUrl: number,
 *   otherReasons: { reason: string, count: number }[] }}
 */
export function parseTap(tapText) {
  const lines = tapText.split('\n');
  /** @param {string} key */
  const summary = (key) => {
    const re = new RegExp(`^# ${key} (\\d+)\\s*$`);
    for (const l of lines) {
      const m = re.exec(l);
      if (m?.[1] !== undefined) return Number(m[1]);
    }
    return null;
  };
  const tests = summary('tests');
  const pass = summary('pass');
  const failed = summary('fail');
  const skipped = summary('skipped');
  if (tests === null || pass === null || failed === null || skipped === null) {
    fail(
      'مُخرَجُ TAP بلا مُلخَّصٍ ختاميٍّ (`# tests`/`# pass`/`# fail`/`# skipped`) — لم تكتملِ التشغيلةُ.',
    );
  }
  const skipLines = lines.filter((l) => l.includes('# SKIP')).length;
  const topLevelSkipPoints = lines.filter((l) => /^(ok|not ok) .*# SKIP/.test(l)).length;
  /** @type {Map<string, number>} */
  const reasons = new Map();
  for (const l of lines) {
    const m = /# SKIP (.*)$/.exec(l);
    if (!m) continue;
    const reason = (m[1] ?? '').trim();
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  let attributedToDatabaseUrl = 0;
  /** @type {{ reason: string, count: number }[]} */
  const otherReasons = [];
  for (const [reason, count] of reasons) {
    if (reason.includes('DATABASE_URL')) attributedToDatabaseUrl += count;
    else otherReasons.push({ reason, count });
  }
  otherReasons.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return {
    tests: /** @type {number} */ (tests),
    pass: /** @type {number} */ (pass),
    fail: /** @type {number} */ (failed),
    skipped: /** @type {number} */ (skipped),
    skipLines,
    topLevelSkipPoints,
    attributedToDatabaseUrl,
    otherReasons,
  };
}

/**
 * توكيداتُ هويّةِ الشجرةِ المقاسةِ — **موضِعُ إغلاقِ منفَذِ `--commit`**.
 *
 * دالّةٌ نقيّةٌ تُصدِرُ لِيُقاسَ رفضُها في الاختبارِ برمزِهِ لا بوصفِهِ — ولأنَّ
 * حاجزاً يَحرُسُ وجودَ ردٍّ ولا يَحرُسُ صحّتَهُ لا يَحرُسُ.
 *
 * @param {{ measuredRoot: string, expectCommit: string, expectMainHead: string }} input
 * @returns {{ measuredSha: string }}
 * @throws {Error} برمزٍ مُسمًَّ: `MEASURE_SHA_MALFORMED` · `MEASURE_COMMIT_MISMATCH` ·
 *   `MEASURE_TREE_DIRTY` · `MEASURE_NOT_MAIN_HEAD`.
 */
export function assertMeasuredIdentity(input) {
  const { measuredRoot, expectCommit, expectMainHead } = input;
  // A5 — الشكلُ أوّلاً: لا اسمَ فرعٍ ولا وسمَ ولا SHA مُختَصَراً (‏`I1`).
  if (!SHA40.test(expectCommit)) {
    throw new Error(`MEASURE_SHA_MALFORMED: --expect-commit ليسَ بصمةً كاملةً: ${expectCommit}`);
  }
  if (!SHA40.test(expectMainHead)) {
    throw new Error(
      `MEASURE_SHA_MALFORMED: --expect-main-head ليسَ بصمةً كاملةً: ${expectMainHead}`,
    );
  }
  // A1 — الكوميتُ **يُشتَقُّ من الجذرِ** ولا يُقبَلُ من مُنادٍ.
  const measuredSha = execFileSync('git', ['-C', measuredRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  // A2 — تصريحُ المُنادي يجبُ أن يُطابِقَ ما في الجذرِ.
  if (measuredSha !== expectCommit) {
    throw new Error(
      `MEASURE_COMMIT_MISMATCH: رأسُ --measured-root ${measuredSha} والمُصرَّحُ ${expectCommit}.`,
    );
  }
  // A3 — شجرةٌ مُوَسَّخةٌ لا يُنسَبُ إليها كوميتٌ: المحتوى ليسَ ما يقولُهُ.
  const porcelain = execFileSync(
    'git',
    ['-C', measuredRoot, 'status', '--porcelain', '--untracked-files=all'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
  if (porcelain !== '') {
    throw new Error(
      `MEASURE_TREE_DIRTY: شجرةُ القياسِ ليسَت نقيّةً — ${porcelain.split('\n').length} مساراً.`,
    );
  }
  // A4 — عقدُ رأسِ main: لا يُقاسُ كوميتٌ تاريخيٌّ ولا فرعٌ آخرُ (‏`I3`).
  if (expectCommit !== expectMainHead) {
    throw new Error(
      `MEASURE_NOT_MAIN_HEAD: المقاسُ ${expectCommit} ورأسُ main ${expectMainHead} — عقدُ القياسِ رأسُ main وحدَهُ.`,
    );
  }
  return { measuredSha };
}

/**
 * `A8` — رمزُ خروجِ التشغيلةِ وعدّادُ TAP يجبُ أن يتفقا — **لا يُقرأُ نجاحٌ
 * من مصدرٍ واحدٍ**. وهذا هوَ الحكمُ الحاسِمُ خلفَ جمعِ TAP: مرحلةُ الجمعِ
 * تَلقُطُ الرمزَ ولا تحكُمُ، وهنا يُحكَمُ. فتشغيلةٌ خرجَت بـ`0` وTAP يقولُ
 * `# fail 3` مردودةٌ — والعكسُ كذلكَ.
 *
 * @param {number} testExit
 * @param {number} rawFail
 * @returns {void}
 * @throws {Error} `MEASURE_EXIT_TAP_DIVERGENT`
 */
export function assertExitAgreesWithTap(testExit, rawFail) {
  const exitSaysOk = testExit === 0;
  const tapSaysOk = rawFail === 0;
  if (exitSaysOk !== tapSaysOk) {
    throw new Error(
      `MEASURE_EXIT_TAP_DIVERGENT: رمزُ الخروجِ ${testExit} وعدّادُ الإخفاقِ ${rawFail} — مصدرانِ يتناقضانِ فلا يُقرأُ منهما حكمٌ.`,
    );
  }
}

function main() {
  const { tap, flags } = parseArgs(process.argv.slice(2));
  if (!existsSync(tap)) fail(`MEASURE_TAP_MISSING: ملفُّ TAP غيرُ موجودٍ: ${tap}`);
  if (flags.commit !== undefined) {
    fail(
      'الوسيطُ --commit محذوفٌ (‏`OPS-1`): الكوميتُ يُشتَقُّ من --measured-root ويُوكَّدُ بـ--expect-commit.',
    );
  }
  for (const required of [
    'engagement',
    'plan',
    'command',
    'measured-root',
    'artifact-root',
    'expect-commit',
    'expect-main-head',
    'test-exit',
  ]) {
    if (!flags[required]) fail(`يلزمُ الوسيطُ --${required}.`);
  }
  const measuredRoot = path.resolve(flags['measured-root'] ?? '');
  const artifactRoot = path.resolve(flags['artifact-root'] ?? '');
  const expectCommit = flags['expect-commit'] ?? '';
  const expectMainHead = flags['expect-main-head'] ?? '';
  const testExitRaw = flags['test-exit'] ?? '';
  if (!/^\d+$/.test(testExitRaw)) fail(`--test-exit يجبُ أن يكونَ عدداً صحيحاً: ${testExitRaw}`);
  const testExit = Number(testExitRaw);

  // A6 — ملفُّ الخطّةِ يُفحَصُ في **الجذرِ الموثوقِ** لا في المقاسِ.
  const planRel = flags.plan ?? '';
  if (!existsSync(path.join(artifactRoot, planRel))) {
    fail(`MEASURE_PLAN_MISSING: ملفُّ الخطّةِ غيرُ موجودٍ في الجذرِ الموثوقِ: ${planRel}`);
  }

  const tapText = readFileSync(tap, 'utf8');
  const measured = parseTap(tapText); // A7 — يَسقُطُ بلا مُلخَّصٍ ختاميٍّ.
  const rawFail = measured.fail;

  // A8 — الحكمُ الحاسِمُ خلفَ جمعِ TAP.
  try {
    assertExitAgreesWithTap(testExit, rawFail);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  // ── LIVE-16: منفذُ الإخفاقِ الذاتيِّ المرجعيِّ — الحكمُ لا يُمَسُّ ──
  // التشغيلةُ التي إخفاقُها الوحيدُ هو تقادُمُ الأثرِ نفسِهِ (R6/STALE أو
  // R7/SCOPE-DRIFT من حاجزِ skip-baseline) يُسمَحُ بتحديثِ الأثرِ عليها — لا
  // بإلغاءِ شرطِ «لا خطَّ أساسٍ من تشغيلةٍ فاشلةٍ»، بل بتمييزِ إخفاقٍ
  // بعينِهِ يَعودُ سببُهُ إلى الأثرِ نفسِهِ. وتشغيلةٌ فيها إخفاقٌ آخرُ — ومنهُ
  // R8/BASE-DRIFT فهوَ **ليسَ ذاتيّاً مرجعيّاً** — ما زالت مردودةً.
  let selfStaleAllowed = false;
  if (rawFail !== 0) {
    const decision = allowSelfStaleOnly(tapText, rawFail);
    if (!decision.allowed) fail(`MEASURE_FOREIGN_FAILURE: ${decision.reason}`);
    selfStaleAllowed = true;
  }

  // A1·A2·A3·A4·A5 — هويّةُ الشجرةِ المقاسةِ.
  /** @type {string} */
  let commit;
  try {
    commit = assertMeasuredIdentity({ measuredRoot, expectCommit, expectMainHead }).measuredSha;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    // لا يُبلَغُ هذا: `fail` يُنهي العمليّةَ. والسببُ مُرفَقٌ لئلّا يُفقَدَ أثرُ السقوطِ
    // إن تغيَّرَ `fail` يوماً فصارَ يَرمي بدلاً من أن يُنهيَ.
    throw new Error('MEASURE_UNREACHABLE: سقوطٌ بعدَ نداءِ fail', { cause: error });
  }

  // A10 — البصمةُ وعدّادُ ملفّاتِ الاختبارِ من **الشجرةِ المقاسةِ** لا من الموثوقةِ.
  const scopeDigest = computeScopeDigest(measuredRoot, commit);
  const measuredOn = flags.date ?? new Date().toISOString().slice(0, 10);

  const artifactPath = path.join(artifactRoot, ARTIFACT);
  /** @type {{ generatedBy: string, contractVersion?: number, measurements: any[] }} */
  const artifact = existsSync(artifactPath)
    ? JSON.parse(readFileSync(artifactPath, 'utf8'))
    : { generatedBy: 'npm run measure:skip-baseline', measurements: [] };
  artifact.generatedBy = 'npm run measure:skip-baseline';
  artifact.contractVersion = CONTRACT_VERSION;
  const entry = {
    engagement: flags.engagement,
    plan: flags.plan,
    command: flags.command,
    commit,
    mainHeadAtMeasure: expectMainHead,
    scopeDigest,
    measuredOn,
    verdict: selfStaleAllowed ? 'self-stale-only' : 'success',
    testFileCount: countTestFiles(measuredRoot),
    ...measured,
  };
  const at = artifact.measurements.findIndex(
    (/** @type {any} */ m) => m.engagement === entry.engagement && m.plan === entry.plan,
  );
  if (at === -1) artifact.measurements.push(entry);
  else artifact.measurements[at] = entry;
  artifact.measurements.sort((/** @type {any} */ a, /** @type {any} */ b) =>
    a.plan.localeCompare(b.plan),
  );
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `✅ خطُّ أساسِ التخطّي مُقاسٌ ومُقيَّدٌ في ${ARTIFACT}\n` +
      `   العقدُ: contractVersion=${CONTRACT_VERSION} · الحكمُ: ${entry.verdict} · رمزُ الخروجِ: ${testExit}\n` +
      `   المقاسُ: ${commit} · رأسُ main عندَ القياسِ: ${expectMainHead}\n` +
      `   بصمةُ النطاقِ: ${scopeDigest}\n` +
      `   الجذرُ المقاسُ: ${measuredRoot} · جذرُ الأثرِ: ${artifactRoot}\n` +
      `   الارتباطُ: ${entry.engagement} · الكوميتُ: ${commit.slice(0, 8)} · التاريخُ: ${measuredOn}\n` +
      `   الاختباراتُ: ${measured.tests} · الناجحُ: ${measured.pass} · الفاشلُ: ${measured.fail}\n` +
      `   عدّادُ التخطّي الختاميُّ: ${measured.skipped} · أسطرُ # SKIP: ${measured.skipLines} · نقاطُ المستوى الأعلى: ${measured.topLevelSkipPoints}\n` +
      `   بسببِ DATABASE_URL: ${measured.attributedToDatabaseUrl} · أسبابٌ أُخرى: ${measured.otherReasons
        .map((r) => `${r.count}× ${r.reason.slice(0, 40)}`)
        .join(' | ')}\n` +
      (selfStaleAllowed
        ? `   ⚠️ سُمِحَ بتحديثِ الأثرِ على تشغيلةٍ إخفاقُها الوحيدُ ذاتيٌّ مرجعيٌّ (R6/STALE أو R7/SCOPE-DRIFT من guard-skip-baseline) — LIVE-16.\n`
        : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
