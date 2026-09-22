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
//   - R6: الأثرُ يُقابَلُ **بالواقعِ** لا بالوثيقةِ وحدَها — فعددُ ملفّاتِ الاختبارِ في الأثرِ
//     يُقابَلُ بعددِها على القرصِ، وأثرٌ قِيسَ على شجرةٍ ثمَّ نمَتْ بملفّاتٍ جديدَةٍ
//     يَسقُطُ لا يَمُرُّ أخضرَ (LIVE-15). وكوميتُ الأثرِ يَبقى للنسبةِ الزمنيّةِ (R5) لا للقياسِ.
//   - R7: بصمةُ **نطاقِ** الشجرةِ في الأثرِ تُقابَلُ ببصمةِ الشجرةِ العاملةِ (‏`OPS-1`).
//     ولماذا لا يُجزِئُ `R6`: ذاكَ يُقابِلُ **عدّاداً** لا هويّةً، فدمجٌ يُعدِّلُ
//     عشرةَ ملفّاتٍ في `src/` بلا إضافةِ ملفِّ اختبارٍ **يَمُرُّ `R6` أخضرَ**
//     والأثرُ يَصِفُ شجرةً لم تَبقَ. وقد قِيسَ: بينَ `eba5afcf` و`54cfec25` بقيَ
//     `testFileCount` = 219 في الشجرتَينِ معَ اختلافِ النطاقِ.
//   - R8: الشجرةُ العاملةُ تحتوي رأسَ `origin/main` أصلاً — فطلبُ دمجٍ تحرَّكَ
//     أساسُهُ بعدَ فتحِهِ يَسقُطُ قبلَ الدمجِ لا بعدَهُ. **ولا يُستثنى بمنفَذِ
//     الإخفاقِ الذاتيِّ قطعاً** (‏`LIVE-16`): لا يقولُ «الأثرُ متقادِمٌ» بل «الأساسُ
//     تحرَّكَ»، وعلاجُهُ إعادةُ قياسٍ لا استثناءٌ.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { countTestFiles } from './lib/doc-count-facts.mjs';
import { computeScopeDigest } from './lib/skip-baseline-scope.mjs';

/**
 * يَقرأُ من `git` في جذرٍ صريحٍ ويَرمي عندَ الفشلِ — **لا يُعيدُ قيمةً بديلةً**،
 * فتعذُّرُ القراءةِ لا يُقرأُ جواباً.
 *
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function gitRead(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * عددُ ملفّاتِ الاختبارِ في **كوميتٍ بعينِهِ** لا على القرصِ.
 *
 * **ولماذا لا يَكفي `countTestFiles` هنا:** ذاكَ يَعُدُّ ما على القرصِ، وهوَ
 * الصوابُ حينَ تُحاكَمُ الشجرةُ العاملةُ (‏فيَرى حتّى ملفّاً غيرَ متعقَّبٍ).
 * أمّا حينَ يُحاكَمُ الأثرُ على شجرةِ الأساسِ فالسؤالُ عن تلكَ الشجرةِ، فيُقرأُ
 * من `git`. والقراءةُ بـ`-z` و`core.quotePath=false` لأنَّ المسارَ غيرَ ASCII
 * يُقتَبَسُ فيَسقُطُ من الأنماطِ بلا خطأٍ (‏`DOC-11`).
 *
 * @param {string} root
 * @param {string} commit
 * @returns {number}
 */
function countTestFilesAtCommit(root, commit) {
  const out = execFileSync(
    'git',
    [
      '-C',
      root,
      '-c',
      'core.quotePath=false',
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      commit,
      'tests',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split('\0').filter((p) => p.endsWith('.test.mjs')).length;
}

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
 *
 * `notices` **ليسَت انتهاكاتٍ ولا هيَ تجاهلٌ**: هيَ حالاتٌ لا تُقاسُ فيها قاعدةٌ
 * لغيابِ مادّتِها (أثرٌ قديمٌ بلا `scopeDigest`، أو جذرٌ بلا `git`، أو `origin/main`
 * غيرُ مجلوبٍ)، **وتُطبَعُ باسمِها في كلِّ تشغيلةٍ** فلا تَسكُنُ صامتةً. ومرحلةُ
 * النشرِ تَرفُضُ أصلاً أثراً دونَ العقدِ `2` (‏`V7`)، فلا يُنشَرُ أثرٌ يُعطِلُ `R7`.
 *
 * @param {string} root
 * @returns {{ violations: string[], notices: string[], entryCount: number, docCount: number }}
 */
export function checkSkipBaseline(root) {
  /** @type {string[]} */
  const violations = [];
  /** @type {string[]} */
  const notices = [];
  const artifactPath = path.join(root, ARTIFACT);

  // ── R1 ──
  if (!existsSync(artifactPath)) {
    return {
      violations: [
        `R1/MISSING: أثرُ القياسِ ${ARTIFACT} غيرُ موجودٍ — وَلِّدْه بـ\`npm run measure:skip-baseline\`.`,
      ],
      notices,
      entryCount: 0,
      docCount: 0,
    };
  }
  /** @type {any} */
  let artifact;
  /** @type {string} نصُّ الأثرِ كما هوَ على القرصِ — يُقابَلُ بنصِّهِ في الأساسِ. */
  let rawArtifact;
  try {
    rawArtifact = readFileSync(artifactPath, 'utf8');
    artifact = JSON.parse(rawArtifact);
  } catch (err) {
    return {
      violations: [
        `R1/UNREADABLE: ${ARTIFACT} لا يُقرأُ JSON — ${/** @type {Error} */ (err).message}`,
      ],
      notices,
      entryCount: 0,
      docCount: 0,
    };
  }
  const entries = Array.isArray(artifact?.measurements) ? artifact.measurements : null;
  if (!entries) {
    return {
      violations: [`R1/SHAPE: ${ARTIFACT} بلا مصفوفةِ \`measurements\`.`],
      notices,
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
    'testFileCount',
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

  // ── تحديدُ الشجرةِ المُحاكَمةِ: الأثرُ يُقابَلُ بالشجرةِ التي **يَصِفُها** ──
  //
  // **هنا كانَ الدورانُ، وهذا موضعُ إصلاحِهِ.** الأثرُ في `main` يَصِفُ شجرةَ
  // `main`. فلو قُوبِلَ بشجرةِ فرعِ عملٍ لَسقطَ بالضرورةِ في كلِّ فرعٍ يُضيفُ
  // ملفَّ اختبارٍ أو يَلمِسُ النطاقَ — **وهذا ليسَ تقادُماً في الأثرِ بل خطأُ
  // مرجِعٍ في السؤالِ**: يُسألُ عن شجرةٍ لا يَدَّعي وصفَها. ثمَّ لا مَخرَجَ:
  // إعادةُ القياسِ تَشترطُ رأسَ `main` (`A4`)، فلا يُنتَجُ أثرٌ صالحٌ من فرعٍ،
  // فيَبقى الفرعُ أحمرَ أبداً.
  //
  // فصارَتِ الشجرةُ المُحاكَمةُ **رأسَ `origin/main`** متى كانَ الجذرُ فرعاً
  // يَحتويهِ، و**الشجرةَ العاملةَ** متى كانَ الجذرُ `main` نفسَهُ أو لا أساسَ
  // مقروءاً. وعلى `main` في CI لا فرقَ: `HEAD === origin/main`، فالقاعدتانِ
  // حاسمتانِ على شجرةِ `main` الفعليّةِ كما كانتا **بلا حرفٍ من تخفيفٍ**.
  //
  // **وليسَ هذا ثقباً في الفرعِ:** ما يَحرُسُ الفرعَ هوَ `R8` (أساسُهُ محتوىً)
  // و`R1`…`R5` (شكلُ الأثرِ وأعدادُهُ المُعلَنةُ) — وكلُّها تُقاسُ على الفرعِ
  // نفسِهِ. وانزياحُ النطاقِ الذي يُحدِثُهُ الفرعُ يُحاكَمُ حيثُ يَصيرُ حقيقةً:
  // على `main` بعدَ الدمجِ، وفي مرحلةِ النشرِ بـ`V5` قبلَ أن يُكتَبَ أثرٌ.
  /** @type {string} المرجِعُ الذي تُقاسُ عليهِ R6 و R7. */
  let judgedRef = 'HEAD';
  /** @type {boolean} هل الشجرةُ المُحاكَمةُ هيَ العاملةُ (لا كوميتٌ بعينِهِ)؟ */
  let judgingWorkTree = true;
  /** @type {string | null} نصُّ الأثرِ في كوميتِ الأساسِ — لِيُعرَفَ أمَسَّهُ الطلبُ أم لا. */
  let artifactAtBase = null;
  {
    /** @type {string | null} */
    let headSha = null;
    /** @type {string | null} */
    let baseSha = null;
    try {
      headSha = gitRead(root, ['rev-parse', 'HEAD']);
      baseSha = gitRead(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']);
    } catch {
      // لا أساسَ مقروءاً: تُحاكَمُ الشجرةُ العاملةُ — وهوَ الأشدُّ لا الأخفُّ.
    }
    if (headSha !== null && baseSha !== null && headSha !== baseSha) {
      let containsBase;
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', baseSha, 'HEAD'], {
          stdio: 'ignore',
        });
        containsBase = true;
      } catch {
        containsBase = false;
      }
      if (containsBase) {
        judgedRef = baseSha;
        judgingWorkTree = false;
        // **وهل الأثرُ في هذا الفرعِ هوَ أثرُ الأساسِ نفسُهُ حرفاً؟** هذا هوَ الفرقُ
        // بينَ **دَينِ `main`** و**جُرمِ الطلبِ**: إن لم يَمَسَّ الطلبُ الأثرَ، فتقادُمُ
        // الأثرِ عن شجرةِ الأساسِ **حالةٌ قائمةٌ في `main` قبلَ الطلبِ** — و`main`
        // حمراءُ بها في تشغيلتِها هيَ، فلا يُطالَبُ طلبٌ بإصلاحِ ما لم يُحدِثْهُ ولا
        // يُسدُّ بهِ مسارُ إعادةِ القياسِ. وإن مَسَّهُ فالحُكمُ عليهِ حاسمٌ.
        try {
          artifactAtBase = gitRead(root, ['show', `${baseSha}:${ARTIFACT}`]);
        } catch {
          artifactAtBase = null;
        }
        notices.push(
          `SCOPE/JUDGED-BASE: الجذرُ فرعٌ يَحتوي رأسَ \`main\` (${baseSha.slice(0, 8)})، فـR6 و R7 تُقاسانِ على شجرةِ \`main\` التي يَصِفُها الأثرُ لا على شجرةِ الفرعِ. وانزياحُ نطاقِ الفرعِ يُحاكَمُ على \`main\` بعدَ الدمجِ وبـ\`V5\` قبلَ النشرِ، وأساسُ الفرعِ يَحرُسُهُ R8.`,
        );
      }
    }
  }

  // **مُوجِّهُ الحُكمِ** — أهوَ جُرمُ الطلبِ أم دَينُ الأساسِ؟ يُستعمَلُ في `R6` و`R7`
  // وحدَهُما، وهُما القاعدتانِ اللتانِ تُقابِلانِ الأثرَ بشجرةٍ. وشرطُ التحويلِ إلى
  // مُلاحظةٍ **ضيّقٌ ومُقاسٌ**: أن يُحاكَمَ أساسٌ، وأن يُقرأَ أثرُ الأساسِ، وأن يكونَ
  // أثرُ الفرعِ **مُطابِقاً لهُ حرفاً**. فإن مَسَّ الطلبُ الأثرَ بحرفٍ صارَ الحُكمُ
  // عليهِ انتهاكاً كما كانَ — فلا يُشترى صمتٌ بتعديلِ أثرٍ.
  const artifactUntouched =
    !judgingWorkTree && artifactAtBase !== null && artifactAtBase.trim() === rawArtifact.trim();
  /** @param {string} message */
  function pushJudgment(message) {
    if (artifactUntouched) {
      notices.push(
        `BASE-STALE: ${message} — **وهذا دَينُ \`main\` لا جُرمُ هذا الطلبِ:** الأثرُ في الفرعِ مُطابِقٌ لأثرِ الأساسِ حرفاً، فالتقادُمُ قائمٌ في \`main\` قبلَ الطلبِ و\`main\` حمراءُ بهِ في تشغيلتِها هيَ حتّى تُعادَ تشغيلةُ القياسِ. ولا يُطالَبُ طلبٌ بإصلاحِ ما لم يُحدِثْهُ، ولا يُسدُّ بهِ مسارُ إعادةِ القياسِ.`,
      );
      return;
    }
    violations.push(message);
  }

  // ── R6 · تقادُمُ الأثرِ ──
  // الأثرُ يُقابَلُ بالواقعِ لا بالوثيقةِ وحدَها: عددُ ملفّاتِ الاختبارِ في الأثرِ يُقابَلُ
  // بعددِها على القرصِ، فأثرٌ قِيسَ على شجرةٍ ثمَّ نمَتْ بملفّاتٍ جديدَةٍ يَسقُطُ لا يَمُرُّ
  // أخضرَ (LIVE-15). وعددُ الملفّاتِ لا يَتغيّرُ بتحديثِ الأثرِ، فلا تبعيّةٌ دائريّةٌ.
  const currentTestFileCount = judgingWorkTree
    ? countTestFiles(root)
    : countTestFilesAtCommit(root, judgedRef);
  for (const [i, e] of entries.entries()) {
    if (Number.isInteger(e?.testFileCount) && e.testFileCount !== currentTestFileCount) {
      pushJudgment(
        `R6/STALE: المُدخلةُ ${i} قِيسَت على ${e.testFileCount} ملفَّ اختبارٍ و${judgingWorkTree ? 'الشجرةُ الحاليّةُ' : 'شجرةُ الأساسِ ' + judgedRef.slice(0, 8)} فيها ${currentTestFileCount} — القياسُ متقادِمٌ، أَعِدْه بـ\`npm run measure:skip-baseline\`.`,
      );
    }
  }

  // ── R7 · بصمةُ النطاقِ: هويّةٌ لا عدّادٌ (‏`OPS-1`) ──
  // `R6` يُقابِلُ عددَ ملفّاتِ الاختبارِ، وشجرتانِ مختلفتانِ لهما عددٌ
  // واحدٌ لا يُفرَّقُ بينَهما. وهذا يُقابِلُ **كائناتِ الشجرةِ** في النطاقِ
  // المُعلَنِ، فأيُّ تغيُّرٍ في محتوى أو صلاحيّةٍ أو اسمٍ يُبدِّلُ البصمةَ.
  {
    const withDigest = entries.filter((/** @type {any} */ e) => typeof e?.scopeDigest === 'string');
    const withoutDigest = entries.length - withDigest.length;
    if (withoutDigest > 0) {
      notices.push(
        `R7/PENDING-MIGRATION: ${withoutDigest} مُدخلةً بلا \`scopeDigest\` — أثرٌ بعقدٍ أقدمَ من \`contractVersion 2\`، فـR7 غيرُ مقيسٍ عليها. وأوّلُ تشغيلةِ قياسٍ تُوَلِّدُ العقدَ الجديدَ وتُفعِّلُها — ومرحلةُ النشرِ تَرفُضُ أصلاً ما دونَ العقدِ 2 (V7).`,
      );
    }
    if (withDigest.length > 0) {
      /** @type {string | null} */
      let currentDigest = null;
      try {
        currentDigest = computeScopeDigest(root, judgedRef);
      } catch (err) {
        // حدٌّ مُعلَنٌ: جذرٌ بلا `git` لا تُحسَبُ له بصمةُ شجرةٍ. وفي CI الجذرُ
        // مستودَعٌ دائماً، ويُقاسُ حسمُ القاعدةِ في اختبارٍ على جذرٍ فيه `git`.
        notices.push(
          `R7/NO-GIT: لا تُحسَبُ بصمةُ نطاقٍ في ${root} — ${/** @type {Error} */ (err).message}`,
        );
      }
      if (currentDigest !== null) {
        for (const [i, e] of entries.entries()) {
          if (typeof e?.scopeDigest !== 'string') continue;
          if (e.scopeDigest !== currentDigest) {
            pushJudgment(
              `R7/SCOPE-DRIFT: المُدخلةُ ${i} قِيسَت على نطاقٍ ببصمةِ ${e.scopeDigest.slice(0, 12)} و${judgingWorkTree ? 'الشجرةُ العاملةُ' : 'شجرةُ الأساسِ ' + judgedRef.slice(0, 8)} ببصمةِ ${currentDigest.slice(0, 12)} — القياسُ متقادِمٌ عن شجرتِهِ، أَعِدْهُ.`,
            );
          }
        }
      }
    }
  }

  // ── R8 · أساسٌ تحرَّكَ (‏`OPS-1`) ──
  // اللحظةُ التي لا يَحرُسُها `R6` ولا `R7`: الأثرُ قِيسَ وفُتِحَ طلبُ دمجٍ،
  // ثمَّ تحرَّكَ `main`. فـ`R7` يُقابِلُ الأثرَ بشجرةِ الفرعِ وتُطابِقُ، والفرعُ
  // معَ ذلكَ **أساسُهُ قديمٌ**. وهذا يُقاسُ بالأصليّةِ لا بالبصمةِ: فرعٌ سليمٌ
  // يختلفُ عن `main` في المحتوى دائماً — وهذا ليسَ عَطباً — لكنَّهُ يجبُ أن
  // **يَحتوي** رأسَ `main`. ومقابلةُ بصمتَينِ هنا تُحمِّرُ كلَّ طلبِ دمجٍ فتُلغي
  // نفسَها — وحاجزٌ يَسقُطُ دائماً يُرخَى ثمَّ يُلغى.
  {
    /** @type {string | null} */
    let mainSha = null;
    try {
      mainSha = execFileSync(
        'git',
        ['-C', root, 'rev-parse', '--verify', 'refs/remotes/origin/main'],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
    } catch {
      // حدٌّ مُعلَنٌ مربوطٌ بـ`EXT-1`: بلا `origin/main` مجلوباً لا مادّةَ للقياسِ.
      // وفي CI تُجلَبُ `main` بخطوةٍ حاسمةٍ قبلَ `validate`، ففشلُ الجلبِ يُسقِطُ
      // الخطوةَ لا يُسكِتُ القاعدةَ.
      notices.push(
        `R8/NO-BASE: \`refs/remotes/origin/main\` غيرُ موجودٍ في ${root} — القاعدةُ بلا مادّةٍ. اجلبْهُ بـ\`git fetch origin main\`.`,
      );
    }
    if (mainSha !== null) {
      let contained = true;
      try {
        execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', mainSha, 'HEAD'], {
          stdio: 'ignore',
        });
      } catch {
        contained = false;
      }
      if (!contained) {
        violations.push(
          `R8/BASE-DRIFT: الشجرةُ العاملةُ لا تحتوي رأسَ origin/main ${mainSha.slice(0, 8)} — الأساسُ تحرَّكَ بعدَ القياسِ. أَعِدِ الأساسَ (rebase) ثمَّ أَعِدِ القياسَ إن تغيَّرَ النطاقُ — **ولا استثناءَ ذاتيَّ لهذه القاعدةِ**.`,
        );
      }
    }
  }

  return { violations, notices, entryCount: entries.length, docCount: declaring };
}

function main() {
  const root = process.cwd();
  const { violations, notices, entryCount, docCount } = checkSkipBaseline(root);
  // المُلاحظاتُ تُطبَعُ **قبلَ الحكمِ وفي حالَيِ النجاحِ والفشلِ** — فقاعدةٌ لا
  // تُقاسُ ولا يُعلَنُ أنّها لا تُقاسُ هيَ سَترٌ.
  for (const n of notices) process.stdout.write(`ℹ️  ${n}\n`);
  if (violations.length > 0) {
    process.stderr.write(
      '⛔ حاجزُ خطِّ أساسِ التخطّي: عددٌ مُعلَنٌ غيرُ مقيسٍ أو غيرُ منسوبٍ أو أصلٌ غيرُ مُطابِقٍ.\n',
    );
    for (const v of violations) process.stderr.write(`   - ${v}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `✅ حاجزُ خطِّ أساسِ التخطّي: ${entryCount} مُدخلةَ قياسٍ و${docCount} وثيقةً مُعلِنةً — كلُّ عددٍ مُعلَنٍ مقيسٌ ومنسوبٌ إلى أمرِه وكوميتِه وعددِ ملفّاتِ شجرتِه وبصمةِ نطاقِه.\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
