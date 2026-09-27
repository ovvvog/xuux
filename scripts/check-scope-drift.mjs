#!/usr/bin/env node
/**
 * فاحصُ انزياحِ النطاق — هل تَحرَّكَت بصمةُ نطاقِ `main` عن الأثرِ المنشورِ؟
 *
 * **علّةُ وجودِ هذه الأداة (`OPS-1/MAIN-DRIFT-WINDOW`):** بعدَ دمجٍ يُغيِّرُ نطاقَ
 * القياسِ، يَحمَرُّ `main` بـ`R7/SCOPE-DRIFT` حتّى تُعادَ دورةُ القياسِ والنشرِ.
 * وكانَ إطلاقُ القياسِ يدويّاً (`workflow_dispatch` ببصمةٍ كاملةٍ)، فطالَ زمنُ
 * الحُمرةِ بلا ضامرٍ. **فصارَ القرارُ آليّاً:** هذه الأداة تَقرأُ الأثرَ المنشورَ
 * وتَحسُبُ بصمةَ نطاقِ `origin/main` وتُقارِنُ. ورموزُ الخروجِ ثلاثةٌ لا اثنانِ:
 * `0` لا انزياحَ (أو لا أهليّةَ)، و`1` انزياحٌ، و`2` خطأٌ يَمنعُ الحُكمَ —
 * **فالعجزُ عنِ الحُكمِ لا يُقرَأُ انزياحاً** ولا يُطلِقُ قياساً.
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
import { pathToFileURL } from 'node:url';
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
 * اسمُ خطوةِ الاختباراتِ وبادئةُ خطوةِ حاجزِ خطِّ الأساسِ في وظيفةِ `validate` من
 * `ci.yml`. **وهما وحدَهما موضعا الإخفاقِ الذاتيِّ المرجعيِّ** (`R6`/`R7`): الحاجزُ
 * يُشغَّلُ في خطوتِهِ، ويُشغَّلُ حيّاً داخلَ الاختباراتِ. فسقوطٌ في أيِّ خطوةٍ أخرى
 * (الفحصِ المُسبَقِ، أو الأسلوبِ، أو الأنواعِ، أو الهجراتِ…) أجنبيٌّ قطعاً، ولا
 * يُطلَقُ عليهِ قياسٌ — كانَ مُصنِّفُ `LIVE-16` سيَرفُضُهُ بعدَ تشغيلةٍ كاملةٍ مهدورةٍ.
 */
export const SELF_STALE_STEPS = Object.freeze({
  tests: 'الاختبارات',
  guardPrefix: 'حاجز خطّ أساس التخطّي',
});

/**
 * يَحكُمُ على تشغيلةِ CI المُحرِّكةِ: هل يُحتمَلُ أن يَكونَ سقوطُها ذاتيّاً مرجعيّاً؟
 *
 * **دالّةٌ نقيّةٌ:** تَأخُذُ وظائفَ التشغيلةِ كما تُعيدُها واجهةُ
 * `GET /actions/runs/{id}/jobs` ولا تَلمِسُ شبكةً ولا قرصاً.
 *
 * - كلُّ وظيفةٍ سقطَتْ يجبُ أن تَكونَ `validate` («فحص الجودة الكامل») أو
 *   `gate-report` (التي تَسقُطُ تبعاً لـ`validate` لا أصالةً).
 * - وفي `validate` يجبُ أن تَكونَ كلُّ خطوةٍ ساقطةٍ خطوةَ الاختباراتِ أو خطوةَ
 *   الحاجزِ، وأن تَسقُطَ واحدةٌ على الأقلِّ.
 * - وما سوى ذلكَ ⇒ `eligible: false` بسببٍ مُسمّىً.
 *
 * @param {unknown} jobsPayload
 * @returns {{ eligible: boolean, reason: string }}
 */
export function classifyTriggerJobs(jobsPayload) {
  const jobs =
    jobsPayload && typeof jobsPayload === 'object'
      ? /** @type {{ jobs?: unknown }} */ (jobsPayload).jobs
      : undefined;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('SCOPE_DRIFT_TRIGGER_JOBS_INVALID: لا وظائفَ مقروءةٌ للتشغيلةِ المُحرِّكةِ.');
  }
  /** @type {string[]} */
  const foreign = [];
  let selfCandidate = 0;
  for (const raw of jobs) {
    const job = /** @type {{ name?: unknown, conclusion?: unknown, steps?: unknown }} */ (raw);
    const name = typeof job.name === 'string' ? job.name : '';
    if (job.conclusion === 'success' || job.conclusion === 'skipped') continue;
    if (name.startsWith('تقرير البوابتين')) continue;
    if (name !== 'فحص الجودة الكامل') {
      foreign.push(`وظيفةٌ: ${name} (${String(job.conclusion)})`);
      continue;
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const rawStep of steps) {
      const step = /** @type {{ name?: unknown, conclusion?: unknown }} */ (rawStep);
      if (step.conclusion !== 'failure' && step.conclusion !== 'cancelled') continue;
      const stepName = typeof step.name === 'string' ? step.name : '';
      if (
        step.conclusion === 'failure' &&
        (stepName === SELF_STALE_STEPS.tests || stepName.startsWith(SELF_STALE_STEPS.guardPrefix))
      ) {
        selfCandidate += 1;
      } else {
        foreign.push(`خطوةٌ: ${stepName} (${String(step.conclusion)})`);
      }
    }
  }
  if (foreign.length > 0) {
    return {
      eligible: false,
      reason: `SCOPE_DRIFT_FOREIGN_TRIGGER: سقوطٌ خارجَ موضعَيِ الإخفاقِ الذاتيِّ — ${foreign.join(' · ')}`,
    };
  }
  if (selfCandidate === 0) {
    return {
      eligible: false,
      reason: 'SCOPE_DRIFT_NO_SELF_FAILURE: لا خطوةَ ساقطةً في الاختباراتِ أو الحاجزِ.',
    };
  }
  return { eligible: true, reason: 'السقوطُ محصورٌ في الاختباراتِ أو الحاجزِ — مُحتمَلٌ ذاتيّاً.' };
}

/**
 * نتيجةُ فحصِ الانزياحِ. **والقرارُ ثلاثيٌّ لا ثنائيٌّ**، والخطأُ ليسَ انزياحاً:
 *
 * - `clean` — البصمتانِ متطابقتانِ، أو التشغيلةُ المُحرِّكةُ ليسَت رأسَ `main`
 *   (تشغيلةٌ أحدثُ ستَحكُمُ). لا قياسَ.
 * - `drift` — البصمتانِ مختلفتانِ على رأسِ `main` نفسِهِ. يُطلَقُ القياسُ.
 * - وكلُّ عجزٍ عنِ الحُكمِ (أثرٌ غائبٌ أو فاسدٌ، مرجعٌ غائبٌ) يُرمى خطأً مُسمّىً
 *   يَخرُجُ بـ`2`، فيَحمَرُّ المسارُ ولا يُطلَقُ قياسٌ على جهلٍ.
 *
 * @typedef {{ decision: 'clean' | 'drift', mainHead: string, publishedDigest: string, currentDigest: string, reason: string }} ScopeDriftResult
 */

/**
 * يَفحَصُ انزياحَ النطاقِ — هل تَحرَّكَت بصمةُ نطاقِ `origin/main` عن الأثرِ المنشورِ؟
 *
 * **دالّةٌ قابلةٌ للاختبارِ** — تَرجِعُ نتيجةً أو تَرمي خطأً مُسمّىً، ولا تَستدعي
 * `process.exit`. ونقطةُ الدخولِ `main()` أدناه هيَ التي تُخرِجُ برمزِ خروجٍ.
 *
 * @param {string} root جذرُ المستودعِ.
 * @param {{ expectHead?: string | undefined }} [options] `expectHead`: بصمةُ رأسِ التشغيلةِ
 *   المُحرِّكةِ؛ إن خالفَت `origin/main` فالقرارُ `clean` (قد تَقدَّمَ `main`).
 * @returns {ScopeDriftResult}
 * @throws {Error} `SCOPE_DRIFT_NO_ARTIFACT` أو `SCOPE_DRIFT_MAIN_HEAD_INVALID` أو
 *   خطأُ `git`.
 */
export function checkScopeDrift(root, options = {}) {
  const published = readPublishedArtifact(root);
  if (!published) {
    throw new Error(
      `SCOPE_DRIFT_NO_ARTIFACT: لا أثرَ منشورٌ صالحٌ في ${ARTIFACT_PATH} — لا حُكمَ على جهلٍ.`,
    );
  }

  const mainHead = getOriginMainHead(root);
  if (options.expectHead && options.expectHead !== mainHead) {
    return {
      decision: 'clean',
      mainHead,
      publishedDigest: published.scopeDigest,
      currentDigest: '',
      reason: `SCOPE_DRIFT_SUPERSEDED: التشغيلةُ المُحرِّكةُ على ${options.expectHead.slice(0, 12)} و\`main\` على ${mainHead.slice(0, 12)} — تشغيلةُ الرأسِ الأحدثِ تَحكُمُ.`,
    };
  }
  const exclusions = loadScopeExclusionsAt(root, mainHead);
  const currentDigest = computeScopeDigest(root, mainHead, exclusions);

  if (currentDigest === published.scopeDigest) {
    return {
      decision: 'clean',
      mainHead,
      publishedDigest: published.scopeDigest,
      currentDigest,
      reason: 'لا انزياحَ — بصمةُ النطاقِ مطابِقةٌ للأثرِ المنشورِ.',
    };
  }

  return {
    decision: 'drift',
    mainHead,
    publishedDigest: published.scopeDigest,
    currentDigest,
    reason: 'انزياحٌ — بصمةُ النطاقِ تَختلِفُ عن الأثرِ المنشورِ.',
  };
}

/** رموزُ الخروجِ — مُعلَنةٌ لأنَّ سيرَ العملِ يَتفرَّعُ عليها. */
export const EXIT = Object.freeze({ clean: 0, drift: 1, error: 2 });

/**
 * يَقرأُ وسائطَ سطرِ الأوامرِ: `--expect-head <sha>` و`--trigger-jobs <file>`.
 *
 * @param {string[]} argv
 * @returns {{ expectHead?: string, triggerJobs?: string }}
 */
function parseArgs(argv) {
  /** @type {{ expectHead?: string, triggerJobs?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--expect-head' || a === '--trigger-jobs') {
      if (!v) throw new Error(`SCOPE_DRIFT_ARG_MISSING: ${a} بلا قيمةٍ.`);
      if (a === '--expect-head') {
        if (!/^[0-9a-f]{40}$/.test(v))
          throw new Error(`SCOPE_DRIFT_ARG_INVALID: ${a} ليسَ بصمةً كاملةً: ${v}`);
        out.expectHead = v;
      } else {
        out.triggerJobs = v;
      }
      i += 1;
    } else {
      throw new Error(`SCOPE_DRIFT_ARG_UNKNOWN: ${a}`);
    }
  }
  return out;
}

/**
 * نقطةُ الدخولِ — تَفحَصُ وتُخرِجُ برمزٍ من `EXIT`.
 *
 * @param {string} [root] جذرُ المستودعِ. `process.cwd()` إن لم يُعطَ.
 */
function main(root = process.cwd()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.triggerJobs) {
      const verdict = classifyTriggerJobs(JSON.parse(readFileSync(args.triggerJobs, 'utf8')));
      console.error(verdict.reason);
      if (!verdict.eligible) {
        process.exitCode = EXIT.clean;
        return;
      }
    }
    const result = checkScopeDrift(root, { expectHead: args.expectHead });
    if (result.mainHead) console.error(`رأسُ origin/main: ${result.mainHead}`);
    if (result.publishedDigest) console.error(`بصمةُ الأثرِ المنشورِ: ${result.publishedDigest}`);
    if (result.currentDigest)
      console.error(`بصمةُ نطاقِ ${result.mainHead}: ${result.currentDigest}`);
    console.error(result.reason);
    process.exitCode = EXIT[result.decision];
  } catch (err) {
    console.error(`⛔ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = EXIT.error;
  }
}

// لا تُشغِّلْ `main` إلا حينَ يُستدعى الملفُّ مباشرةً لا حينَ يُستورَدُ للاختبارِ.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
