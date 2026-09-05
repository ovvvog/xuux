/**
 * قراءةُ بنودِ معاييرِ الاكتمالِ من نصِّ خارطةِ الطريقِ — الخطوة `M11.08`.
 *
 * **البنودُ تُقرأ من مصدرِها لا تُكتَب بيدٍ:** قائمةٌ مكتوبةٌ بيدٍ في تقريرِ
 * جاهزيّةٍ تنسى البندَ الذي لا يُحبُّ كاتبُها ذكرَه؛ فصفوفُ الخطواتِ تُستخرَج من
 * جداولِ الخارطةِ نفسِها، والبواباتُ من عناوينِها المعلَنةِ فيها. ولذلك يقيس
 * الحاجزُ **عددَ** ما قُرِئ ويردُّ الحكمَ إن خالفَ العددَ المُعلَنَ في العقدِ: فمَن
 * غيَّرَ جدولاً وسكتَ عن التقريرِ يُكشَف بالعدِّ لا بالثقةِ.
 *
 * والوحدةُ **نقيّةٌ**: تأخذ نصّاً وتُعيد بنوداً، ولا تلمس قرصاً ولا ساعةً.
 *
 * @module readiness/items
 */

/**
 * @typedef {object} StepItem
 * @property {'step'} kind
 * @property {string} id
 * @property {string} title
 * @property {string} criterion
 * @property {string} statusMark
 */

/**
 * @typedef {object} GateItem
 * @property {'gate'} kind
 * @property {string} id
 * @property {string} statement
 */

const STEP_ROW = /^\|\s*(M\d+\.\d+)\s*\|(.+)\|\s*(✅|⬜|⛔|⏸️|🟨)\s*\|\s*$/;

/**
 * يقرأ صفوفَ الخطواتِ كلَّها بترتيبِ ظهورِها.
 *
 * @param {string} roadmapText
 * @returns {StepItem[]}
 */
export function readSteps(roadmapText) {
  /** @type {StepItem[]} */
  const steps = [];
  const seen = new Set();
  for (const line of String(roadmapText).split('\n')) {
    const match = STEP_ROW.exec(line);
    if (match === null) continue;
    const id = String(match[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const cells = String(match[2])
      .split('|')
      .map((cell) => cell.trim());
    steps.push({
      kind: 'step',
      id,
      title: cells[0] ?? '',
      criterion: cells[cells.length - 1] ?? '',
      statusMark: String(match[3]),
    });
  }
  return steps;
}

/**
 * يقرأ البواباتِ المعلَنةَ من سطورِ عنوانِها (‏🚪) بترتيبِ ظهورِها.
 *
 * @param {string} roadmapText
 * @returns {GateItem[]}
 */
export function readGates(roadmapText) {
  /** @type {GateItem[]} */
  const gates = [];
  const seen = new Set();
  for (const line of String(roadmapText).split('\n')) {
    if (!line.includes('🚪')) continue;
    const match = /\b(G\d+)\b/.exec(line);
    if (match === null) continue;
    const id = String(match[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    gates.push({
      kind: 'gate',
      id,
      statement: line
        .replace(/\*\*/g, '')
        .replace(/^#+\s*/, '')
        .replace('🚪', '')
        .trim(),
    });
  }
  return gates;
}

/**
 * @param {string} roadmapText
 * @returns {(StepItem | GateItem)[]}
 */
export function readItems(roadmapText) {
  return [...readSteps(roadmapText), ...readGates(roadmapText)];
}
