/**
 * بصمةُ نطاقِ القياسِ — هويّةُ الشجرةِ التي قِيسَ عليها خطُّ أساسِ التخطّي.
 *
 * **علّةُ وجودِ هذه الوحدةِ عَطَبٌ قِيسَ لا خطرٌ مُتخيَّلٌ (`OPS-1`):** القاعدةُ
 * `R6` في `guard:skip-baseline` تُقابِلُ **عدّادَ ملفّاتِ اختبارٍ**
 * (`testFileCount`) لا هويّةَ شجرةٍ. فشجرتانِ مختلفتانِ لهما عددُ ملفّاتِ
 * اختبارٍ واحدٌ **لا يُفرَّقُ بينَهما**: دمجٌ يُعدِّلُ عشرةَ ملفّاتٍ في `src/`
 * بلا إضافةِ ملفِّ اختبارٍ **يَمُرُّ `R6` أخضرَ** والأثرُ يَصِفُ شجرةً لم تَبقَ.
 * وقد قِيسَ هذا فعلاً: بينَ `eba5afcf` و`54cfec25` بقيَ `testFileCount` = `219`
 * في الشجرتَينِ معَ اختلافِ سبعةِ مساراتٍ. فمقياسٌ يُقابِلُ رقماً ولا يُقابِلُ
 * واقعاً **لا يَحرُسُ** — وهوَ صنفُ `LIVE-15` بعينِهِ.
 *
 * والعلاجُ **بنيويٌّ لا بتعليقٍ**: بصمةٌ تجزيئيّةٌ على **مجموعةِ الكائناتِ**
 * (`mode`·`type`·`object`·`path`) لكلِّ مسارٍ في النطاقِ. فأيُّ تغييرٍ في محتوى
 * ملفٍّ أو في صلاحيّتِهِ أو في اسمِهِ يُبدِّلُ البصمةَ.
 *
 * **وقراءةُ المساراتِ بـ`-z` لازمةٌ لا تجميليّةٌ:** `git ls-tree` بلا `-z`
 * يُقتبِسُ ويُهرِّبُ المسارَ غيرَ ASCII، وفي هذا المستودعِ مساراتٌ عربيّةٌ فعلاً
 * (‏`federation/regions/001/provinces/ولاية-001-01/README.md`). فقراءةٌ ساذجةٌ
 * تُنتِجُ بصمةً على مساراتٍ مهروبةٍ — تَتغيَّرُ بتغيُّرِ إعدادِ `core.quotePath`
 * لا بتغيُّرِ الشجرةِ. وذاكَ إخفاءٌ صامتٌ لا خطأٌ يُرفَعُ (‏`DOC-11`).
 *
 * @module lib/skip-baseline-scope
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** مسارُ إعلانِ النطاقِ — يُقرأُ برنامجاً لا بـ`grep`. */
export const SCOPE_CONFIG = 'config/skip-baseline-scope.yaml';

/**
 * يُطبِّقُ `git` بجذرٍ صريحٍ. **لا `process.cwd()` في هذه الوحدةِ أبداً** —
 * فالأداةُ تَعملُ على شجرتَينِ مختلفتَينِ (المقاسةِ والموثوقةِ) في تشغيلةٍ واحدةٍ،
 * وجذرٌ ضمنيٌّ هوَ عينُ ما جَعَلَ `--commit` مُنفَذاً للتزييفِ.
 *
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function git(root, args) {
  return execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * مساراتُ الاستثناءِ المُعلَنةُ — **تُقرأُ من YAML برنامجاً**.
 *
 * @param {string} root جذرٌ فيه `config/skip-baseline-scope.yaml`.
 * @returns {string[]} بادئاتُ الاستثناءِ كما أُعلِنَت.
 * @throws {Error} إن غابَ الإعلانُ أو لم يَكُنْ YAML صالحاً أو لم يَكُنْ شكلُهُ متوقَّعاً.
 */
export function loadScopeExclusions(root) {
  const configPath = path.join(root, SCOPE_CONFIG);
  /** @type {string} */
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    throw new Error(`SCOPE_CONFIG_MISSING: لا يمكنُ قراءةُ ${SCOPE_CONFIG} في ${root}.`);
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = parseYaml(text);
  } catch {
    throw new Error(`SCOPE_CONFIG_PARSE: ${SCOPE_CONFIG} ليسَ YAML صالحاً.`);
  }
  const nonScope =
    parsed && typeof parsed === 'object'
      ? /** @type {{ nonScope?: unknown }} */ (parsed).nonScope
      : undefined;
  if (!Array.isArray(nonScope) || nonScope.some((entry) => typeof entry !== 'string')) {
    throw new Error(`SCOPE_CONFIG_SHAPE: ${SCOPE_CONFIG} يلزمُهُ حقلُ nonScope قائمةَ نصوصٍ.`);
  }
  return nonScope.map((entry) => String(entry));
}

/**
 * هل المسارُ مُستثنىً من النطاقِ؟ — مطابقةُ بادئةٍ على المسارِ كما هوَ على القرصِ.
 *
 * @param {string} filePath
 * @param {string[]} exclusions
 * @returns {boolean}
 */
export function isExcluded(filePath, exclusions) {
  return exclusions.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

/**
 * كائناتُ الشجرةِ الداخلةُ في النطاقِ — مقروءةً بـ`-z` بلا اقتباسٍ ولا هروبٍ.
 *
 * @param {string} root
 * @param {string} commit مُعرِّفُ كوميتٍ أو شجرةٍ (‏`HEAD` مقبولٌ).
 * @param {string[]} [exclusions] يُقرَأُ من `root` إن لم يُعطَ.
 * @returns {{ mode: string, type: string, object: string, path: string }[]} مرتَّبةً بايتيّاً بالمسارِ.
 */
export function listScopeEntries(root, commit, exclusions) {
  const excl = exclusions ?? loadScopeExclusions(root);
  const raw = git(root, ['ls-tree', '-r', '-z', commit]);
  /** @type {{ mode: string, type: string, object: string, path: string }[]} */
  const entries = [];
  for (const record of raw.split('\0')) {
    if (record.length === 0) continue;
    // الصيغةُ: `<mode> SP <type> SP <object> TAB <path>` — و`-z` يَمنعُ الهروبَ.
    const tab = record.indexOf('\t');
    if (tab === -1) throw new Error(`SCOPE_LS_TREE_SHAPE: سجلٌّ بلا فاصلِ مسارٍ: ${record}`);
    const meta = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    const mode = meta[0] ?? '';
    const type = meta[1] ?? '';
    const object = meta[2] ?? '';
    if (mode === '' || type === '' || object === '') {
      throw new Error(`SCOPE_LS_TREE_SHAPE: سجلٌّ ناقصُ البيانِ: ${record}`);
    }
    if (isExcluded(filePath, excl)) continue;
    entries.push({ mode, type, object, path: filePath });
  }
  entries.sort((a, b) => (Buffer.from(a.path) < Buffer.from(b.path) ? -1 : 1));
  return entries;
}

/**
 * بصمةُ النطاقِ: `sha256` على كائناتِ الشجرةِ الداخلةِ في النطاقِ.
 *
 * حتميّةٌ: نفسُ الكوميتِ ⇒ نفسُ البصمةِ. وتغيُّرُ محتوىً أو صلاحيّةٍ أو اسمٍ في
 * النطاقِ ⇒ بصمةٌ مختلفةٌ. وتغيُّرٌ في `docs/external-review/` ⇒ **بصمةٌ واحدةٌ**
 * (الاستثناءُ المُعلَنُ — وبهِ لا يُبطِلُ الأثرُ نفسَهُ).
 *
 * @param {string} root
 * @param {string} commit
 * @param {string[]} [exclusions]
 * @returns {string} بصمةٌ ستّةَ عشريّةٌ بطولِ ٦٤.
 */
export function computeScopeDigest(root, commit, exclusions) {
  const entries = listScopeEntries(root, commit, exclusions);
  const hash = createHash('sha256');
  hash.update(`skip-baseline-scope/v1\n${entries.length}\n`);
  for (const entry of entries) {
    hash.update(`${entry.mode} ${entry.type} ${entry.object}\t${entry.path}\n`);
  }
  return hash.digest('hex');
}

/**
 * المساراتُ التي اختلفَت في النطاقِ بينَ كوميتَينِ — **للتقريرِ لا للحكمِ**.
 *
 * موجودةٌ لأنَّ رفضاً بلا تسميةِ سببِهِ يَدفعُ المنفِّذَ إلى التخمينِ، والتخمينُ
 * يَنتهي إلى إرخاءِ القاعدةِ. فحينَ تَسقُطُ `I5` أو `R7` يُطبَعُ **ما اختلفَ**.
 *
 * @param {string} root
 * @param {string} commitA
 * @param {string} commitB
 * @returns {string[]} مساراتٌ مرتَّبةٌ، مئةٌ كأقصى حدٍّ ثمَّ إشارةٌ إلى الباقي.
 */
export function scopeDiff(root, commitA, commitB) {
  const excl = loadScopeExclusions(root);
  /** @param {{ object: string, mode: string, path: string }[]} entries */
  const index = (entries) => new Map(entries.map((e) => [e.path, `${e.mode}:${e.object}`]));
  const a = index(listScopeEntries(root, commitA, excl));
  const b = index(listScopeEntries(root, commitB, excl));
  /** @type {string[]} */
  const differing = [];
  for (const [filePath, signature] of a) {
    const other = b.get(filePath);
    if (other === undefined) differing.push(`- ${filePath}`);
    else if (other !== signature) differing.push(`~ ${filePath}`);
  }
  for (const filePath of b.keys()) {
    if (!a.has(filePath)) differing.push(`+ ${filePath}`);
  }
  differing.sort();
  if (differing.length > 100) {
    return [...differing.slice(0, 100), `… و${differing.length - 100} مساراً آخرَ`];
  }
  return differing;
}

/**
 * القراءةُ الساذجةُ (بلا `-z`) — **موجودةٌ لتُقاسَ لا لتُستعمَلَ**: بها يُثبَتُ في
 * الاختبارِ أنَّ العَطَبَ واقعٌ — أنَّ `git` يُهرِّبُ المسارَ العربيَّ فتَخرُجُ
 * بصمةٌ على نصٍّ مهروبٍ — وأنَّ العلاجَ يُخرِجُ ما كانت تُخفيه (‏`DOC-11`).
 *
 * @param {string} root
 * @param {string} commit
 * @returns {string[]} المساراتُ كما يُخرِجُها `git` بلا `-z` وبلا `core.quotePath=false`.
 */
export function listTreePathsQuoted(root, commit) {
  const raw = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', commit], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return raw.split('\n').filter((line) => line.length > 0);
}
