import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

/**
 * @typedef {object} ReviewEngagement
 * @property {string} id
 * @property {unknown} acceptanceCriteria
 * @property {Record<string, unknown>} [executedBy]
 */

/**
 * جذرُ المستودعِ من هذا الاختبارِ: `tests/external-review/` ثمَّ مستويانِ.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config', 'external-review.yaml');
const REPORTS_DIR = path.join(REPO_ROOT, 'docs', 'external-review', 'reports');
const CORRECTION_NOTE = path.join(
  REPO_ROOT,
  'docs',
  'external-review',
  'M11.05-round-5-heading-correction.md',
);

/**
 * يقرأُ العقدَ ويُعيدُ الارتباطاتِ ذاتَ مجلسِ النماذجِ وحدَها — فغيرُ المجلسِ
 * لا تقاريرَ خامّةً له على القرصِ بجولاتٍ مرقّمةٍ.
 * @returns {ReviewEngagement[]}
 */
function councilEngagements() {
  const parsed = YAML.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const engagements = Array.isArray(parsed?.engagements) ? parsed.engagements : [];
  return engagements.filter(
    (/** @type {ReviewEngagement} */ engagement) =>
      engagement?.executedBy?.kind === 'model-council',
  );
}

/**
 * اسمُ ملفٍّ خامٍّ يطابقُ `‏<ارتباط>-round-<جولة>-model-council-report-<عضو>.md`
 * — ويعيدُ رقمَ الجولةِ أو `null`.
 * @param {string} fileName
 * @param {string} engagementId
 * @returns {number | null}
 */
function roundFromFileName(fileName, engagementId) {
  const match = fileName.match(
    new RegExp(`^${engagementId}-round-(\\d+)-model-council-report-[^.]+\\.md$`),
  );
  return match === null ? null : Number(match[1]);
}

test('CO55-M11.05-R3-03: كلُّ جولةٍ لها تقريرٌ خامٌّ على القرصِ لا تتجاوزُ عدَّادَ جولاتِ عقدِها', () => {
  // النتيجةُ: عقدُ M11.05 أعلنَ `executedBy.rounds: 2` بينما 5 جولاتٍ لها
  // تقاريرُ خامّةٌ على القرصِ — فجولةٌ منفَّذةٌ لم يعرفِ العقدُ بها. والقاعدةُ
  // هنا عامّةٌ لكلِّ ارتباطٍ بمجلسِ نماذجٍ: لا تقريرَ خامّاً لجولةٍ يتجاوزُ
  // رقمُها العدَّادَ المعلنَ، وإلا سقطَ هذا الاختبارُ قبلَ أن يقرأَ عضوُ
  // المجلسِ عقداً يُخالفُ ما على القرصِ.
  const engagements = councilEngagements();
  assert.ok(engagements.length >= 3, 'ارتباطاتُ المجلسِ الثلاثةُ مقروءةٌ من العقدِ');
  const violations = [];
  const onDisk = existsSync(REPORTS_DIR) ? readdirSync(REPORTS_DIR) : [];
  for (const engagement of engagements) {
    const declared = engagement.executedBy?.rounds;
    assert.ok(
      Number.isInteger(declared),
      `عقدُ ${engagement.id} يُعلنُ executedBy.rounds عدداً صحيحاً`,
    );
    for (const fileName of onDisk) {
      const round = roundFromFileName(fileName, engagement.id);
      if (round === null) continue;
      if (round > /** @type {number} */ (declared)) {
        violations.push(
          `${engagement.id}: تقريرُ جولةِ ${round} على القرصِ (${fileName}) يتجاوزُ العدَّادَ المعلنَ ${declared}`,
        );
      }
    }
  }
  assert.deepEqual(violations, [], 'لا جولةً منفَّذةً على القرصِ خارجَ عدَّادِ العقدِ');
});

test('CO55-M11.05-R3-03: كلُّ جولةٍ في عضويةِ عضوٍ من عقدِ المجلسِ لا تتجاوزُ عدَّادَ جولاتِه', () => {
  // العدُّ في العقدِ لا يكفي: فالعضويةُ نفسُها بيانٌ يُقابَلُ بالعدَّادِ، فلا
  // يُسجَّلُ عضوٌ بجولةٍ يقولُ العقدُ إنها لم تُنفَّذْ بعد.
  const engagements = councilEngagements();
  const violations = [];
  for (const engagement of engagements) {
    const declared = engagement.executedBy?.rounds;
    const members = engagement.executedBy?.members;
    if (!Array.isArray(members)) continue;
    for (const member of members) {
      const rounds = member?.rounds;
      if (!Array.isArray(rounds)) continue;
      for (const round of rounds) {
        if (Number.isInteger(round) && round > /** @type {number} */ (declared)) {
          violations.push(
            `${engagement.id}: العضوُ ${member.id} مسجَّلٌ بجولةِ ${round} والعدَّادُ ${declared}`,
          );
        }
      }
    }
  }
  assert.deepEqual(violations, [], 'لا عضويةً بجولةٍ خارجِ عدَّادِ العقدِ');
});

test('CO55-M11.05-R3-03: رقمُ الجولةِ في عنوانِ التقريرِ الخامِّ يطابقُ رقمَها في اسمِ ملفِّهِ — إلا استثناءً مُوثَّقاً', () => {
  // النتيجةُ: ملفا الجولةِ الخامسةِ لـM11.05 يحملانِ عنوانَ «الجولة 3» خطأً.
  // التقريرُ الخامُّ لا يُعدَّلُ بعدَ صدورِهِ، فالتصحيحُ يُقيَّدُ في مذكرةِ
  // التصحيحِ بجانبِهِ — وهي مصدرُ الاستثناءاتِ هنا: عنوانٌ لا يطابقُ اسمَ
  // الملفِّ يسقُطُ الاختبارَ ما لم يُوثَّقْ في المذكرةِ بعِلَّةٍ.
  const note = readFileSync(CORRECTION_NOTE, 'utf8');
  const fenced = note.match(/```yaml\n([\s\S]*?)```/);
  const yamlText = fenced === null ? null : fenced[1];
  if (yamlText === null || yamlText === undefined) {
    assert.fail('مذكرةُ التصحيحِ تحملُ كتلةَ yaml للاستثناءاتِ');
  }
  const known = YAML.parse(yamlText);
  const allowlist = new Map(
    (known?.knownHeadingMismatches ?? []).map(
      (/** @type {{ file: string, headingRound: number }} */ exception) => [
        exception.file,
        exception.headingRound,
      ],
    ),
  );
  const engagements = councilEngagements();
  const onDisk = existsSync(REPORTS_DIR) ? readdirSync(REPORTS_DIR) : [];
  const violations = [];
  for (const engagement of engagements) {
    for (const fileName of onDisk) {
      if (roundFromFileName(fileName, engagement.id) === null) continue;
      const relative = `docs/external-review/reports/${fileName}`;
      const firstLine =
        readFileSync(path.join(REPORTS_DIR, fileName), 'utf8').split('\n', 1)[0] ?? '';
      // لا تُفحصُ العناوينُ التي لا تحملُ رقمَ جولةٍ صريحاً بأرقامٍ (أُولياتٌ
      // عربيةٌ أو عنوانٌ إنجليزيٌّ) — فالمطابقةُ هنا على الصريحِ الرقميِّ وحدَه.
      const headingMatch = firstLine.match(/الجولة\s*(\d+)/);
      if (headingMatch === null) continue;
      const headingRound = Number(headingMatch[1]);
      const fileRound = roundFromFileName(fileName, engagement.id);
      if (allowlist.has(relative)) {
        assert.equal(
          headingRound,
          allowlist.get(relative),
          `استثناءُ ${relative} المُوثَّقُ في مذكرةِ التصحيحِ يطابقُ عنوانَ الملفِّ الفعليَّ`,
        );
        continue;
      }
      if (headingRound !== fileRound) {
        violations.push(
          `${relative}: الاسمُ يقولُ الجولةَ ${fileRound} والعنوانُ يقولُ ${headingRound} — صلِّحِ العنوانَ أو وثِّقِ الاستثناءَ في مذكرةِ التصحيحِ`,
        );
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'كلُّ عنوانٍ رقميٍّ صريحٍ يطابقُ اسمَ ملفِّهِ أو استثناءً موثَّقاً',
  );
});
