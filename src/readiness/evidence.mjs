/**
 * ربطُ كلِّ بندٍ بدليلِه على القرصِ — الخطوة `M11.08`.
 *
 * **الدليلُ موضعٌ لا ادّعاءٌ:** لا يُقبَل أن يُقال «مُنجَزٌ ومُختبَرٌ» بلا إشارةٍ
 * إلى سطرٍ يُقرأ. فلكلِّ بندٍ هنا قائمةُ مواضعٍ: مُدخلاتُ سجلِّ العملِ التي تذكره
 * نصّاً، وجداولُ «أدلّة تنفيذ» في الخارطةِ التي تذكره بدليلِه.
 *
 * **وحدٌّ معلَنٌ يُقرأ مع كلِّ سطرٍ بعده:** هذه الوحدةُ تقيس **وجودَ الدليلِ
 * وموضعَه لا كفايتَه**. فمُدخلةُ سجلٍّ دليلٌ على أنّ العملَ وُثِّقَ بمنفِّذِه
 * وتاريخِه وما لم يتمَّ منه — **لا شهادةٌ بأنّ الضابطَ كافٍ**؛ وكفايةُ الضوابطِ
 * شأنُ `M11.04`–`M11.06` وحدَها ولا تُنتحَل هنا.
 *
 * والوحدةُ **نقيّةٌ**: نصوصٌ تدخل وبنودٌ موصولةٌ بمواضعِها تخرج.
 *
 * **وتمييزُ الإسنادِ من السياقِ (إغلاقُ `LIVE-4`):** كان كلُّ ذِكرٍ لمعرِّفِ بندٍ في
 * أيِّ موضعٍ من المُدخلةِ يُقرأ **دليلَ تنفيذٍ له** — فمُدخلةٌ تقولُ «الخطوةُ
 * `M4.03` محجوبةٌ» أو «هذه الوثيقةُ عن `G7` قديمةٌ» **تُصيِّرُ البندَ ذا دليلٍ**،
 * وذِكرُ الحَجبِ يُقرأ إنجازاً. فصارَ الدليلُ **نوعَينِ مُفرَّقَينِ لا نوعاً واحداً**:
 *
 * - `evidence:worklog-attribution` — البندُ مُعلَنٌ في **موضعِ الإسنادِ** من
 *   المُدخلةِ (حقلُ «المسار والخطوة» من قالبِ المادةِ 6، سطراً كان أو ترويسةً).
 * - `evidence:worklog-mention` — البندُ مذكورٌ في المتنِ **دونَ إسنادٍ مُعلَنٍ**؛
 *   ذِكرٌ يُشار إلى موضعِه، **لا إعلانَ أنّ المُدخلةَ عملٌ على البندِ**.
 *
 * **وصيغةُ الإحالةِ المحيَّدةِ** (`NEUTRAL_REFERENCE_PREFIX`): من ذكرَ بنداً ولم
 * يُرِدْ أن يُقرأ ذِكرُه دليلاً — كالإحالةِ إلى وثيقةٍ قديمةٍ أو خطوةٍ محجوبةٍ —
 * كتبَ المعرِّفَ مسبوقاً بها، فلا يُقرأ إسناداً ولا ذِكراً. **والحيادُ مُعلَنٌ في
 * موضعِ قراءتِه** (الثابتُ أدناه) ومقيسٌ بالقاعدةِ `R11` في
 * `scripts/guard-readiness.mjs` — فحذفُه يُسقِطُ البوابةَ لا يُخضِّرُها.
 *
 * **والضمانُ `G-READINESS-ATTRIBUTION-NOT-MENTION` يُنفَّذ هنا:** ما وردَ في حقلِ
 * الإسنادِ أو العنوانِ إسنادٌ، وما وردَ في سائرِ المتنِ ذِكرٌ، وما سُبِقَ بصيغةِ
 * الإحالةِ المحيَّدةِ فلا هذا ولا ذاكَ.
 *
 * @module readiness/evidence
 */

/**
 * @typedef {object} EvidenceRef
 * @property {string} kind
 * @property {string} where
 * @property {string} locator
 */

/**
 * **صيغةُ الإحالةِ المحيَّدةِ** — سابقةٌ تُكتَب قبلَ معرِّفِ البندِ مباشرةً
 * (ويجوزُ أن يليَها فراغٌ أو علامةُ شفرةٍ) فيُستثنى ذلكَ الذِّكرُ من الدليلِ
 * كلِّه: `لا-إسناد:‏\`M4.03\``. وهي **لكلِّ ذِكرٍ على حدةٍ** لا للمُدخلةِ كلِّها،
 * فمُدخلةٌ تُسنِدُ إلى بندٍ وتُحيلُ محيَّداً إلى آخرَ تُقرأ على وجهِها في كلٍّ.
 */
export const NEUTRAL_REFERENCE_PREFIX = 'لا-إسناد:';

/**
 * عنوانُ **موضعِ الإسنادِ** في المُدخلةِ — حقلُ قالبِ المادةِ 6 الذي يُعلِنُ على
 * أيِّ بندٍ وقعَ العملُ. ويُقبَل شكلاه المستعملانِ في السجلِّ: سطرُ قائمةٍ
 * (`- **المسار والخطوة:** …`) وترويسةٌ (`#### المسار والخطوة`).
 */
export const ATTRIBUTION_FIELD_TITLE = 'المسار والخطوة';

/**
 * @typedef {object} WorkLogEntry
 * @property {string} id
 * @property {string} heading
 * @property {string} body
 */

/**
 * يُقسِّم سجلَّ العملِ إلى مُدخلاتٍ بمعرِّفاتِها — بلا تعديلِ حرفٍ منها.
 *
 * @param {string} workLogText
 * @returns {WorkLogEntry[]}
 */
export function readWorkLogEntries(workLogText) {
  const lines = String(workLogText).split('\n');
  /** @type {WorkLogEntry[]} */
  const entries = [];
  /** @type {WorkLogEntry | null} */
  let current = null;
  for (const line of lines) {
    const match = /^###\s*\[[^\]]+\]\s*—\s*(WL-\d{3})\s*—\s*(.*)$/.exec(line);
    if (match !== null) {
      if (current !== null) entries.push(current);
      current = { id: String(match[1]), heading: String(match[2]), body: '' };
      continue;
    }
    if (current !== null) current.body += `${line}\n`;
  }
  if (current !== null) entries.push(current);
  return entries;
}

/**
 * جداولُ «أدلّة تنفيذ» في الخارطةِ: صفٌّ لكلِّ بندٍ بدليلِه المُتحقَّقِ منه.
 *
 * @param {string} roadmapText
 * @returns {Map<string, string>}
 */
export function readRoadmapEvidenceRows(roadmapText) {
  /** @type {Map<string, string>} */
  const rows = new Map();
  let inside = false;
  for (const line of String(roadmapText).split('\n')) {
    if (/^###\s*أدلّة تنفيذ/.test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^#{1,3}\s/.test(line)) inside = false;
    if (!inside) continue;
    const match = /^\|\s*(M\d+\.\d+)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (match === null) continue;
    if (!rows.has(String(match[1]))) rows.set(String(match[1]), String(match[2]));
  }
  return rows;
}

/**
 * @param {string} id
 * @returns {RegExp}
 */
function mentionPattern(id) {
  const escaped = id.replace('.', '\\.');
  // يُقبَل ذِكرٌ يتلوه نقطةُ جملةٍ («… نصَّت M1.06.») ويُرفَض ذِكرٌ هو جزءٌ من
  // معرِّفٍ أطولَ («M1.061»)؛ فمن ضيَّقَ المطابقةَ قرأ دليلاً موجوداً غياباً.
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w]|\\.\\d)`, 'g');
}

/**
 * هل يوجدُ ذِكرٌ **غيرُ محيَّدٍ** للبندِ في هذا النصِ؟
 *
 * والموضعُ محيَّدٌ إن سُبِقَ مباشرةً بـ`NEUTRAL_REFERENCE_PREFIX` (ويُتجاوزُ ما
 * بينهما من فراغٍ أو علامةِ شفرةٍ أو محايدِ اتِّجاهٍ). **والحيادُ للذِّكرِ لا
 * للنصِّ**: ذِكرٌ واحدٌ غيرُ محيَّدٍ يكفي لقراءةِ النصِّ ذاكِراً.
 *
 * @param {string} text
 * @param {string} id
 * @returns {boolean}
 */
function mentionsUnneutralized(text, id) {
  const haystack = String(text);
  const pattern = mentionPattern(id);
  for (const match of haystack.matchAll(pattern)) {
    const before = haystack
      .slice(0, match.index)
      // يُجرَّدُ ما لا يحملُ معنىً بينَ السابقةِ والمعرِّفِ: فراغٌ، علامةُ شفرةٍ،
      // محايدُ اتِّجاهٍ (‏‎؜) — فمن كتبَ السابقةَ والمعرِّفَ بشفرةٍ بينهما قصدَ الحيادَ.
      .replace(/[\s`\u200e\u200f\u061c]+$/u, '');
    if (!before.endsWith(NEUTRAL_REFERENCE_PREFIX)) return true;
  }
  return false;
}

/**
 * يستخرجُ **موضعَ الإسنادِ** من متنِ مُدخلةٍ — نصَّ حقلِ «المسار والخطوة»
 * وحدَه دونَ سائرِ المتنِ. ويُقرأ شكلاه المستعملانِ في السجلِّ معاً:
 *
 * 1. **سطرُ قائمةٍ**: `- **المسار والخطوة:** …` وما يتلوه من أسطرٍ
 *    مُزاحةٍ حتّى بندٍ جديدٍ أو ترويسةٍ.
 * 2. **ترويسةٌ**: `#### المسار والخطوة` وما تحتَها حتّى الترويسةِ التاليةِ.
 *
 * ومُدخلةٌ بلا الحقلِ تُرجِعُ نصّاً فارغاً — **ولا يُفترَضُ إسنادٌ لمن لم يُعلِنْه**.
 *
 * @param {string} body
 * @returns {string}
 */
export function attributionTextOf(body) {
  const lines = String(body).split('\n');
  /** @type {string[]} */
  const collected = [];
  /** @type {'none' | 'list' | 'heading'} */
  let mode = 'none';
  for (const line of lines) {
    if (mode === 'none') {
      const listStart = new RegExp(
        `^\\s*[-*]\\s*\\*\\*\\s*${ATTRIBUTION_FIELD_TITLE}\\s*:?\\s*\\*\\*\\s*:?(.*)$`,
      ).exec(line);
      if (listStart !== null) {
        collected.push(String(listStart[1]));
        mode = 'list';
        continue;
      }
      const headingStart = new RegExp(`^#{2,6}\\s*${ATTRIBUTION_FIELD_TITLE}\\s*$`).exec(line);
      if (headingStart !== null) {
        mode = 'heading';
        continue;
      }
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      mode = 'none';
      continue;
    }
    if (mode === 'list') {
      // سطرٌ غيرُ مُزاحٍ يبدأ بنداً جديداً يُغلِقُ الحقلَ: فحدُّ الحقلِ حدُّه لا ما بعدَه.
      if (/^\s*[-*]\s/.test(line) || line.trim() === '') {
        mode = 'none';
        continue;
      }
      collected.push(line);
      continue;
    }
    collected.push(line);
  }
  return collected.join('\n');
}

/**
 * يجمع مواضعَ دليلِ بندٍ واحدٍ.
 *
 * @param {string} id
 * @param {{ entries: WorkLogEntry[], roadmapRows: Map<string, string>, workLogPath: string, roadmapPath: string }} sources
 * @returns {EvidenceRef[]}
 */
export function evidenceFor(id, sources) {
  /** @type {EvidenceRef[]} */
  const refs = [];
  for (const entry of sources.entries) {
    // **الإسنادُ يُقرأ من حقلِه المُعلَنِ وحدَه**؛ والترويسةُ معَه لأنّ عنوانَ
    // المُدخلةِ إعلانُ موضوعِها لا سياقُ حديثٍ عارِضٍ.
    const attribution = attributionTextOf(entry.body);
    if (
      mentionsUnneutralized(entry.heading, id) ||
      (attribution !== '' && mentionsUnneutralized(attribution, id))
    ) {
      refs.push({
        kind: 'evidence:worklog-attribution',
        where: sources.workLogPath,
        locator: entry.id,
      });
      continue;
    }
    if (mentionsUnneutralized(entry.body, id)) {
      refs.push({
        kind: 'evidence:worklog-mention',
        where: sources.workLogPath,
        locator: entry.id,
      });
    }
  }
  const row = sources.roadmapRows.get(id);
  if (row !== undefined) {
    refs.push({
      kind: 'evidence:roadmap-table',
      where: sources.roadmapPath,
      locator: `صفُّ «أدلّة تنفيذ» للبندِ ${id}`,
    });
  }
  return refs;
}
