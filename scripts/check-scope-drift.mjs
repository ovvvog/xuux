#!/usr/bin/env node
/**
 * فاحصُ انزياحِ النطاق — هل تَحرَّكَت بصمةُ نطاقِ `main` عن الأثرِ المنشورِ؟
 *
 * **علّةُ وجودِ هذه الأداة (`OPS-1/MAIN-DRIFT-WINDOW`):** بعدَ دمجٍ يُغيِّرُ نطاقَ
 * القياسِ، يَحمَرُّ `main` بـ`R7/SCOPE-DRIFT` حتّى تُعادَ دورةُ القياسِ والنشرِ.
 * وكانَ إطلاقُ القياسِ يدويّاً (`workflow_dispatch` ببصمةٍ كاملةٍ)، فطالَ زمنُ
 * الحُمرةِ بلا ضامرٍ. **فصارَ القرارُ آليّاً:** هذه الأداة تَقرأُ الأثرَ المنشورَ
 * وتَحسُبُ بصمةَ نطاقِ `origin/main` وتُقارِنُ. فإنِ انحرفَت ⇒ يَخرُجُ بـ`1`
 * ويَطبَعُ البصمتَينِ؛ وإن لم تَنحرف ⇒ يَخرُجُ بـ`0` ويَطبَعُ «لا انزياحَ».
 *
 * **وهي لا تُطلِقُ القياسَ بنفسِها:** تُنتِجُ حُكماً قابلاً للقياسِ برمزِ خروجٍ،
 * ويُطلِقُ سيرُ العملُ القياسَ بناءً عليه. فالقرارُ والتنفيذُ مفصولانِ كما في
 * عقدِ `OPS-1` كلِّهِ: هذه الأداة تَقرأُ وتَحكُمُ ولا تَكتُبُ.
 *
 * @module check-scope-drift
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computeScopeDigest, loadScopeExclusionsAt } from './lib/skip-baseline-scope.mjs';

/** مسارُ الأثرِ المنشورِ. */
const ARTIFACT_PATH = 'docs/external-review/skip-baseline.json';

/**
 * يَقرأُ الأثرَ المنشورَ ويَستخرجُ بصمةَ النطاقِ من أوّلِ مُدخلةٍ فيه.
 *
 * @param {string} root جذرُ المستودعِ الموثوقِ.
 * @returns {{ scopeDigest: string, commit: string, measuredSha: string } | null}
 *   `null` إن لم يُوجَدْ أثرٌ أو لم تَكُنْ فيه بصمةٌ.
 */
function readPublishedArtifact(root) {
  const fullPath = path.join(root, ARTIFACT_PATH);
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(fullPath, 'utf8');
  } catch {
    return null;
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const measurements =
    parsed && typeof parsed === 'object'
      ? /** @type {{ measurements?: unknown }} */ (parsed).measurements
      : undefined;
  if (!Array.isArray(measurements) || measurements.length === 0) return null;
  const first = measurements[0];
  if (!first || typeof first !== 'object') return null;
  const m = /** @type {{ scopeDigest?: unknown, commit?: unknown, measuredSha?: unknown }} */ (
    first
  );
  if (typeof m.scopeDigest !== 'string' || !/^[0-9a-f]{64}$/.test(m.scopeDigest)) return null;
  return {
    scopeDigest: m.scopeDigest,
    commit: typeof m.commit === 'string' ? m.commit : '',
    measuredSha: typeof m.measuredSha === 'string' ? m.measuredSha : '',
  };
}

/**
 * يَقرأُ رأسَ `origin/main` من المرجعِ المحلّيِّ — **بلا جلبٍ**.
 *
 * الجلبُ مسؤوليّةُ سيرِ العملِ لا مسؤوليّةَ الأداةِ: الأداةُ تَقرأُ المرجعَ
 * الموجودَ، وسيرُ العملِ يَجلِبُهُ طازجاً قبلَ ندائِها. فالقرارُ والنقلُ
 * مفصولانِ كما في عقدِ `OPS-1` كلِّهِ.
 *
 * @param {string} root
 * @returns {string} بصمةٌ كاملةٌ أربعونَ محرفاً.
 * @throws {Error} إن لم يَكُنْ `origin/main` متاحاً أو لم يَكُنْ شكلُهُ صحيحاً.
 */
function getOriginMainHead(root) {
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'refs/remotes/origin/main'], {
    encoding: 'utf8',
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error(`SCOPE_DRIFT_MAIN_HEAD_INVALID: رأسُ origin/main ليسَ بصمةً كاملةً: ${head}`);
  }
  return head;
}

/**
 * نتيجةُ فحصِ الانزياحِ.
 *
 * @typedef {{ drifted: boolean, mainHead: string, publishedDigest: string, currentDigest: string, reason: string }} ScopeDriftResult
 */

/**
 * يَفحَصُ انزياحَ النطاقِ — هل تَحرَّكَت بصمةُ نطاقِ `origin/main` عن الأثرِ المنشورِ؟
 *
 * **دالةٌ قابلةٌ للاختبارِ** — تَرجِعُ نتيجةً ولا تَستدعي `process.exit`.
 * ونقطةُ الدخولِ `main()` أدناه هيَ التي تُخرِجُ برمزِ خروجٍ.
 *
 * @param {string} root جذرُ المستودعِ.
 * @returns {ScopeDriftResult}
 * @throws {Error} إن غابَ `origin/main` أو فَسَدَ الأثرُ.
 */
export function checkScopeDrift(root) {
  const published = readPublishedArtifact(root);
  if (!published) {
    return {
      drifted: true,
      mainHead: '',
      publishedDigest: '',
      currentDigest: '',
      reason: 'SCOPE_DRIFT_NO_ARTIFACT: لا أثرَ منشورٌ — يُطلَقُ القياسُ.',
    };
  }

  const mainHead = getOriginMainHead(root);
  const exclusions = loadScopeExclusionsAt(root, mainHead);
  const currentDigest = computeScopeDigest(root, mainHead, exclusions);

  if (currentDigest === published.scopeDigest) {
    return {
      drifted: false,
      mainHead,
      publishedDigest: published.scopeDigest,
      currentDigest,
      reason: `لا انزياحَ — بصمةُ النطاقِ مطابِقةٌ للأثرِ المنشورِ.`,
    };
  }

  return {
    drifted: true,
    mainHead,
    publishedDigest: published.scopeDigest,
    currentDigest,
    reason: `انزياحٌ — بصمةُ النطاقِ تَختلِفُ عن الأثرِ المنشورِ.`,
  };
}

/**
 * نقطةُ الدخولِ — تَفحَصُ وتُخرِجُ برمزِ خروجٍ.
 *
 * @param {string} [root] جذرُ المستودعِ. `process.cwd()` إن لم يُعطَ.
 */
function main(root = process.cwd()) {
  const result = checkScopeDrift(root);
  if (result.mainHead) console.error(`رأسُ origin/main: ${result.mainHead}`);
  if (result.publishedDigest) console.error(`بصمةُ الأثرِ المنشورِ: ${result.publishedDigest}`);
  if (result.currentDigest)
    console.error(`بصمةُ نطاقِ ${result.mainHead}: ${result.currentDigest}`);
  console.error(result.reason);
  process.exit(result.drifted ? 1 : 0);
}

// لا تُشغِّلْ `main` إلا حينَ يُستورَدُ الملفُّ مباشرةً لا حينَ يُستورَدُ للاختبارِ.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
