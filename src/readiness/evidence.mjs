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
 * @module readiness/evidence
 */

/**
 * @typedef {object} EvidenceRef
 * @property {string} kind
 * @property {string} where
 * @property {string} locator
 */

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
  return new RegExp(`(?<![\\w.])${escaped}(?![\\w]|\\.\\d)`);
}

/**
 * يجمع مواضعَ دليلِ بندٍ واحدٍ.
 *
 * @param {string} id
 * @param {{ entries: WorkLogEntry[], roadmapRows: Map<string, string>, workLogPath: string, roadmapPath: string }} sources
 * @returns {EvidenceRef[]}
 */
export function evidenceFor(id, sources) {
  const pattern = mentionPattern(id);
  /** @type {EvidenceRef[]} */
  const refs = [];
  for (const entry of sources.entries) {
    if (pattern.test(entry.heading) || pattern.test(entry.body)) {
      refs.push({
        kind: 'evidence:worklog-entry',
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
