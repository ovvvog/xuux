/**
 * قراءةُ مساراتِ Git **بلا هروبٍ ولا اقتباسٍ** — إغلاقُ الدَّينِ `DOC-11`.
 *
 * **علّةُ وجودِ هذه الوحدةِ عَطَبٌ قِيسَ لا خطرٌ مُتخيَّلٌ:** `git ls-files` يُخرِجُ
 * المساراتِ **مقتبَسةً ومهروبةً** إذا كانت غيرَ ASCII (‏`core.quotePath` أصلُه
 * `true`)، فمسارٌ عربيٌّ يخرجُ هكذا:
 *
 * ```text
 * "institutions/001-\330\247\331\204\330\257\331\212\331\210\330\247\331\206/test.spec.ts"
 * ```
 *
 * فمن رشّحَ المخرَجَ بنمطٍ ينتهي بـ`test.spec.ts$` **لم يرَ الملفَّ أصلاً** —
 * لا لأنّه غيرُ متعقَّبٍ، بل لأنّ سطرَه ينتهي باقتباسٍ. وهذا **إخفاءٌ صامتٌ**:
 * العدُّ ينقصُ ولا يُرفَعُ خطأٌ. وقد أُنتِجَ به فعلاً دَينٌ كاذبٌ (‏`DOC-11` في
 * `WL-200`: «ثلاثةُ مساراتٍ مأذونةٍ لم تبقَ» — وهي على القرصِ ومتعقَّبةٌ).
 * **وأخطرُ منه:** فحصٌ يبحثُ عن مادّةِ مفاتيحَ متعقَّبةٍ بلاحقةِ `.pem$` يمرُّ على
 * مفتاحٍ تحتَ مسارٍ عربيٍّ.
 *
 * والعلاجُ **بنيويٌّ لا بتعليقٍ**: `-z` يفصلُ بمحرفِ `NUL` **ولا يهرُبُ شيئاً**.
 *
 * @module lib/git-files
 */

import { execFileSync } from 'node:child_process';

/**
 * مساراتٌ متعقَّبةٌ كما هي على القرصِ: بلا اقتباسٍ ولا هروبٍ ولا إسقاطٍ صامتٍ.
 *
 * @param {{ cwd: string, args?: string[], maxBuffer?: number }} options
 * @returns {string[]}
 */
export function listTrackedFiles(options) {
  const args = options.args ?? [];
  const out = execFileSync('git', ['ls-files', '-z', ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  return out.split('\0').filter((entry) => entry.length > 0);
}

/**
 * القراءةُ الساذجةُ (سطراً سطراً) — **موجودةٌ لتُقاسَ لا لتُستعمَلَ**: بها يُثبَتُ
 * أنّ العَطَبَ واقعٌ وأنّ العلاجَ يُخرِجُ ما كانت تُخفيه.
 *
 * @param {{ cwd: string, args?: string[] }} options
 * @returns {string[]}
 */
export function listTrackedFilesQuoted(options) {
  const args = options.args ?? [];
  const out = execFileSync('git', ['ls-files', ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\n').filter((entry) => entry.length > 0);
}
