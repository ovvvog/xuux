#!/usr/bin/env node
/**
 * شاهدُ «طلبُ النشرِ الآليُّ يُحاكَمُ آليّاً» — `OPS-1/BOT-PR-CI` · `WL-315`.
 *
 * **علّةُ وجودِه:** `WL-311` أضافَ إلى مسارِ النشرِ إرسالَ `workflow_dispatch` إلى
 * `ci.yml` على فرعِ النشرِ، لكنَّ الخطوةَ تَحكُمُ بـ«ظهرت تشغيلةٌ» لا بـ«وَقَعَ الحكمُ
 * على رأسِ الطلبِ». فنجحَ النشرُ أربعَ مرّاتٍ (‏`#230`…`#233`) ولم يُقَسْ مرّةً واحدةً
 * هل حملَ رأسُ الطلبِ «فحص الجودة الكامل» ناجحاً **من تشغيلةٍ آليّةٍ** قبلَ أيِّ
 * تدخُّلٍ يدويٍّ — وأُعيدَ فتحُ الطلبِ في كلِّها قبلَ أن تنتهيَ التشغيلةُ الآليّةُ.
 * فمعيارُ الإغلاقِ بقيَ ادّعاءً.
 *
 * **وتصحيحُ `WL-318` (‏مقيسٌ على `#236` و`#237`):** فحصُ تشغيلةِ `workflow_dispatch`
 * يُقيَّدُ على البصمةِ **لكنّه لا يدخلُ `statusCheckRollup` للطلبِ** — والحمايةُ تقرأُ
 * الـrollup. فالحكمُ الأوّلُ (‏`WL-315`) نجحَ على `#237` والطلبُ `BLOCKED`. والقياسُ
 * الصحيحُ هو ما تقرأُه الحمايةُ نفسُها.
 *
 * **ما يَحكُمُ به:** في `statusCheckRollup` لرأسِ الطلبِ فحصٌ باسمِ السياقِ المطلوبِ،
 * ناجحٌ، **ومجموعتُه لتشغيلةِ `pull_request` على `ci.yml` فاعلُها `github-actions[bot]`**
 * (‏أي أُطلِقَت وأُقِرَّت آليّاً، لا بإعادةِ فتحٍ ولا بإقرارِ إنسان)، وأحدثُ فحصٍ بالاسمِ
 * على البصمةِ ناجحٌ. وتشغيلاتُ `pull_request` المحجوزةُ `action_required` بلا فحوصٍ
 * تُسمّى أشباحاً ولا تُحتسَب.
 *
 * رموزُ الخروجِ: `0` حكمٌ ناجحٌ · `1` حكمٌ راسبٌ · `2` عجزٌ عن الحكم (‏لا يُقرَأُ نجاحاً).
 * يَقرأُ ولا يَكتُبُ.
 *
 * @module verify-bot-pr-ci
 */

import { pathToFileURL } from 'node:url';

/** السياقُ المطلوبُ في حمايةِ `main` — اسمُ وظيفةِ `validate` في `ci.yml`. */
export const REQUIRED_CONTEXT = 'فحص الجودة الكامل';

/** أصلُ واجهةِ GitHub — يُضبَطُ في Actions بـ`GITHUB_API_URL`. */
const API_ROOT = process.env.GITHUB_API_URL ?? 'https://api.github.com';

/** نقطةُ GraphQL — يُضبَطُ في Actions بـ`GITHUB_GRAPHQL_URL`. */
const GRAPHQL_URL =
  process.env.GITHUB_GRAPHQL_URL ?? API_ROOT.replace(/\/v3$/, '').replace(/\/$/, '') + '/graphql';

/** فاعلُ `GITHUB_TOKEN`. */
export const BOT_ACTOR = 'github-actions[bot]';

/**
 * @typedef {{ id: number, event: string, status: string, conclusion: string | null,
 *   triggering_actor: string, check_suite_id: number, head_sha: string, path: string }} RunInfo
 * @typedef {{ name: string, status: string, conclusion: string | null, app: string,
 *   check_suite_id: number, head_sha: string, started_at: string | null }} CheckInfo
 * @typedef {{ name: string, conclusion: string | null, check_suite_id: number | null }} RollupInfo
 * @typedef {{ ok: boolean, code: string, detail: string, automaticRunIds: number[],
 *   phantomRunIds: number[] }} Verdict
 */

/**
 * الحكمُ الخالصُ — بلا شبكةٍ، فيُقاسُ على شواهدَ مسجَّلةٍ.
 *
 * @param {{ headSha: string, runs: RunInfo[], checks: CheckInfo[], rollup: RollupInfo[] | null,
 *   requiredContext?: string }} input
 * @returns {Verdict}
 */
export function judgeBotPrCi({
  headSha,
  runs,
  checks,
  rollup,
  requiredContext = REQUIRED_CONTEXT,
}) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    return {
      ok: false,
      code: 'BOT_PR_CI_BAD_SHA',
      detail: `بصمةُ الرأسِ ليست كاملةً: ${headSha}`,
      automaticRunIds: [],
      phantomRunIds: [],
    };
  }
  const onHead = runs.filter((r) => r.head_sha === headSha && r.path.endsWith('ci.yml'));
  const suitesWithChecks = new Set(checks.map((c) => c.check_suite_id));
  const phantom = onHead.filter(
    (r) =>
      r.event === 'pull_request' &&
      r.triggering_actor === BOT_ACTOR &&
      !suitesWithChecks.has(r.check_suite_id),
  );
  // آليٌّ = تشغيلةُ `pull_request` أطلقَها وأقرَّها `GITHUB_TOKEN` وحملت فحوصاً.
  const automatic = onHead.filter(
    (r) =>
      r.event === 'pull_request' &&
      r.triggering_actor === BOT_ACTOR &&
      suitesWithChecks.has(r.check_suite_id),
  );
  const base = {
    automaticRunIds: automatic.map((r) => r.id),
    phantomRunIds: phantom.map((r) => r.id),
  };
  const automaticSuites = new Set(automatic.map((r) => r.check_suite_id));
  const inRollup = (rollup ?? []).filter((c) => c.name === requiredContext);
  if (inRollup.length === 0) {
    return {
      ...base,
      ok: false,
      code: 'BOT_PR_ROLLUP_MISSING',
      detail: `لا «${requiredContext}» في statusCheckRollup لرأسِ الطلبِ ${headSha} — الحمايةُ لا ترى فحصاً (‏فحصُ workflow_dispatch لا يدخلُ الـrollup).`,
    };
  }
  if (automatic.length === 0) {
    return {
      ...base,
      ok: false,
      code: 'BOT_PR_CI_NO_AUTOMATIC_RUN',
      detail: `الفحصُ في الـrollup ليس من تشغيلةِ pull_request أطلقَها وأقرَّها ${BOT_ACTOR} على ${headSha} — تدخُّلٌ يدويٌّ لا حكمٌ آليّ.`,
    };
  }
  const automaticInRollup = inRollup.filter(
    (c) => c.check_suite_id !== null && automaticSuites.has(c.check_suite_id),
  );
  if (automaticInRollup.length === 0) {
    return {
      ...base,
      ok: false,
      code: 'BOT_PR_CI_NO_AUTOMATIC_RUN',
      detail: `«${requiredContext}» في الـrollup من مجموعةٍ غيرِ آليّةٍ على ${headSha}.`,
    };
  }
  if (!automaticInRollup.some((c) => c.conclusion === 'SUCCESS' || c.conclusion === 'success')) {
    return {
      ...base,
      ok: false,
      code: 'BOT_PR_CI_RUN_NOT_SUCCESS',
      detail: `«${requiredContext}» الآليُّ في الـrollup ليس ناجحاً: ${automaticInRollup
        .map((c) => String(c.conclusion))
        .join(', ')}.`,
    };
  }
  const named = checks.filter(
    (c) => c.head_sha === headSha && c.name === requiredContext && c.app === 'github-actions',
  );
  const latest = [...named].sort((x, y) =>
    String(y.started_at ?? '').localeCompare(String(x.started_at ?? '')),
  )[0];
  if (latest && !(latest.status === 'completed' && latest.conclusion === 'success')) {
    return {
      ...base,
      ok: false,
      code: 'BOT_PR_CHECK_SUPERSEDED',
      detail: `أحدثُ فحصٍ «${requiredContext}» على ${headSha} حالُه ${latest.status}/${latest.conclusion} — الحمايةُ تقرأُ الأحدث.`,
    };
  }
  return {
    ...base,
    ok: true,
    code: 'BOT_PR_CI_OK',
    detail: `«${requiredContext}» ناجحٌ في statusCheckRollup لرأسِ الطلبِ ${headSha} من تشغيلةِ pull_request آليّةٍ (${automatic
      .map((r) => r.id)
      .join(', ')}) بلا تدخُّل.`,
  };
}

/**
 * @param {string} token
 * @param {string} url
 * @returns {Promise<any>}
 */
async function gh(token, url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GET ${url} ⇒ HTTP ${res.status}`);
  return res.json();
}

/**
 * يَجمعُ الشواهدَ من GitHub لطلبٍ بعينِه.
 *
 * @param {{ token: string, repo: string, pr: number }} opts
 */
export async function collect({ token, repo, pr }) {
  const api = `${API_ROOT}/repos/${repo}`;
  const pull = await gh(token, `${api}/pulls/${pr}`);
  const headSha = String(pull.head.sha);
  const runsJson = await gh(token, `${api}/actions/runs?head_sha=${headSha}&per_page=100`);
  /** @type {RunInfo[]} */
  const runs = (runsJson.workflow_runs ?? []).map((/** @type {any} */ r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    conclusion: r.conclusion,
    triggering_actor: r.triggering_actor?.login ?? '',
    check_suite_id: r.check_suite_id,
    head_sha: r.head_sha,
    path: r.path ?? '',
  }));
  const checksJson = await gh(token, `${api}/commits/${headSha}/check-runs?per_page=100`);
  /** @type {CheckInfo[]} */
  const checks = (checksJson.check_runs ?? []).map((/** @type {any} */ c) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion,
    app: c.app?.slug ?? '',
    check_suite_id: c.check_suite?.id,
    head_sha: c.head_sha,
    started_at: c.started_at,
  }));
  const [owner, name] = repo.split('/');
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){
        commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:50){nodes{
          __typename ... on CheckRun{name conclusion checkSuite{databaseId}}
          ... on StatusContext{context state}}}}}}}}}}`,
      variables: { o: owner, n: name, p: pr },
    }),
  });
  if (!res.ok) throw new Error(`GraphQL ⇒ HTTP ${res.status}`);
  /** @type {any} */
  const gql = await res.json();
  if (gql.errors) throw new Error(`GraphQL: ${JSON.stringify(gql.errors).slice(0, 300)}`);
  const commit = gql.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit;
  if (!commit || commit.oid !== headSha) throw new Error('GraphQL: رأسُ الطلبِ لا يطابقُ REST.');
  /** @type {RollupInfo[] | null} */
  const rollup = commit.statusCheckRollup
    ? commit.statusCheckRollup.contexts.nodes.map((/** @type {any} */ n) =>
        n.__typename === 'CheckRun'
          ? {
              name: n.name,
              conclusion: n.conclusion,
              check_suite_id: n.checkSuite?.databaseId ?? null,
            }
          : { name: n.context, conclusion: n.state, check_suite_id: null },
      )
    : null;
  return { headSha, author: String(pull.user?.login ?? ''), runs, checks, rollup };
}

/**
 * ينتظرُ اكتمالَ تشغيلةٍ بعينِها.
 *
 * @param {{ token: string, repo: string, runId: number, timeoutSec: number, intervalSec?: number }} opts
 * @returns {Promise<any>}
 */
export async function waitForRun({ token, repo, runId, timeoutSec, intervalSec = 20 }) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const run = await gh(token, `${API_ROOT}/repos/${repo}/actions/runs/${runId}`);
    if (run.status === 'completed') return run;
    if (Date.now() > deadline) return null;
    console.log(`التشغيلةُ ${runId}: ${run.status} — انتظار…`);
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k?.startsWith('--') || v === undefined) throw new Error(`وسيطٌ غيرُ صالحٍ: ${k}`);
    out[k.slice(2)] = v;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GH_TOKEN ?? '';
  const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? '';
  const pr = Number(args.pr);
  if (!token || !repo || !Number.isInteger(pr) || pr <= 0) {
    console.error(
      'الاستعمال: GH_TOKEN=… node scripts/verify-bot-pr-ci.mjs --repo o/r --pr N [--wait-run ID --timeout-sec S]',
    );
    process.exit(2);
  }
  if (args['wait-run']) {
    const done = await waitForRun({
      token,
      repo,
      runId: Number(args['wait-run']),
      timeoutSec: Number(args['timeout-sec'] ?? 1800),
    });
    if (!done) {
      console.error(
        `::error::BOT_PR_CI_TIMEOUT: لم تكتمل التشغيلةُ ${args['wait-run']} في المهلة.`,
      );
      process.exit(1);
    }
    console.log(`التشغيلةُ ${done.id}: ${done.status}/${done.conclusion}`);
  }
  const evidence = await collect({ token, repo, pr });
  const verdict = judgeBotPrCi(evidence);
  console.log(
    JSON.stringify({ pr, author: evidence.author, headSha: evidence.headSha, ...verdict }, null, 2),
  );
  if (verdict.phantomRunIds.length > 0) {
    console.log(
      `::notice::تشغيلاتُ pull_request شبحيّةٌ بلا فحوصٍ (لا تحجبُ): ${verdict.phantomRunIds.join(', ')}`,
    );
  }
  if (!verdict.ok) {
    console.error(`::error::${verdict.code}: ${verdict.detail}`);
    process.exit(1);
  }
  console.log(`✅ ${verdict.code}: ${verdict.detail}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`::error::BOT_PR_CI_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  });
}
