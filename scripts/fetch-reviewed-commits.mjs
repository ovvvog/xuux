#!/usr/bin/env node
/**
 * جلبُ كوميتاتِ المراجعةِ المُعلَنةِ في عقدِ المراجعةِ الخارجيّةِ.
 *
 * **لماذا يُوجَدُ هذا:** `R6-A-10` يَقرأُ خطّةَ كلِّ جولةٍ **في الكوميتِ الذي راجعَهُ
 * المجلسُ**، وبعضُ تلكَ الكوميتاتِ يَسكُنُ `refs/pull/<n>/head` لا فرعاً — و
 * `fetch-depth: 0` يَجلُبُ الفروعَ والوسومَ **لا مراجعَ الطلباتِ**. فكانَ الحارسُ
 * يَخضَرُّ في مجلدِ عملِ العدّاءِ المقيمِ لأنَّ الكائنَ بقيَ فيهِ من تشغيلةٍ سابقةٍ،
 * ويَحمَرُّ في أيِّ خروجٍ نظيفٍ. **وخُضرةٌ تَستنِدُ إلى بقايا مجلدٍ ليست خاصيّةَ
 * مستودَعٍ** — وهذا ما كشفَتْهُ تشغيلةُ القياسِ `35716702520`.
 *
 * والعقدُ يُقرأُ **ببرنامجٍ (YAML) لا بـ`grep`**، والفشلُ صريحٌ: كوميتُ مراجعةٍ
 * مُعلَنٌ لا يُقرأُ **يُسقِطُ هذا الأمرَ**، فلا يُقرأُ تعذُّرُ الجلبِ نجاحاً.
 *
 * ولا يُعدَّلُ `config/external-review.yaml` بحرفٍ — يُقرأُ فقط.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parse } from 'yaml';

const CONTRACT = 'config/external-review.yaml';

/**
 * @param {string} root
 * @returns {string[]}
 */
export function declaredReviewedCommits(root) {
  const contract = parse(readFileSync(path.join(root, CONTRACT), 'utf8'));
  const engagements = Array.isArray(contract?.engagements) ? contract.engagements : [];
  /** @type {string[]} */
  const commits = [];
  for (const engagement of engagements) {
    const reviewed = engagement?.executedBy?.reviewedCommit;
    if (typeof reviewed === 'string' && reviewed.length > 0 && !commits.includes(reviewed)) {
      commits.push(reviewed);
    }
  }
  return commits;
}

/**
 * @param {string} root
 * @param {string} commit
 * @returns {boolean}
 */
function readable(root, commit) {
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${commit}:package.json`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @returns {{ commits: string[], fetched: string[], missing: string[] }}
 */
export function fetchReviewedCommits(root) {
  const commits = declaredReviewedCommits(root);
  /** @type {string[]} */
  const fetched = [];
  /** @type {string[]} */
  const missing = [];
  const already = commits.filter((c) => readable(root, c));
  const wanted = commits.filter((c) => !already.includes(c));
  if (wanted.length > 0) {
    // مراجعُ الطلباتِ أوّلاً — وهيَ مسكنُ الكوميتاتِ المُراجَعةِ غالباً.
    try {
      execFileSync(
        'git',
        ['-C', root, 'fetch', '--no-tags', 'origin', '+refs/pull/*/head:refs/remotes/pr/*'],
        { stdio: 'ignore' },
      );
    } catch {
      // يُقاسُ الأثرُ لا النيّةُ: ما بقيَ غيرَ مقروءٍ يُسمّى أدناهُ.
    }
    for (const commit of wanted) {
      if (readable(root, commit)) {
        fetched.push(commit);
        continue;
      }
      try {
        execFileSync('git', ['-C', root, 'fetch', '--no-tags', 'origin', commit], {
          stdio: 'ignore',
        });
      } catch {
        // كذلكَ.
      }
      if (readable(root, commit)) fetched.push(commit);
      else missing.push(commit);
    }
  }
  return { commits, fetched, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? process.cwd();
  const { commits, fetched, missing } = fetchReviewedCommits(root);
  console.log(
    `ℹ️  كوميتاتُ المراجعةِ المُعلَنةُ: ${commits.length} — مجلوبٌ الآنَ: ${fetched.length}`,
  );
  if (missing.length > 0) {
    console.error(
      `⛔ REVIEWED_COMMIT_UNREADABLE: كوميتُ مراجعةٍ مُعلَنٌ لا يُقرأُ بعدَ الجلبِ: ${missing.join('، ')} — و\`R6-A-10\` يَقيسُ حضورَ الخطّةِ فيهِ، فتعذُّرُ القراءةِ لا يُقرأُ نجاحاً.`,
    );
    process.exit(1);
  }
  console.log('✅ كلُّ كوميتِ مراجعةٍ مُعلَنٍ مقروءٌ هنا.');
}
