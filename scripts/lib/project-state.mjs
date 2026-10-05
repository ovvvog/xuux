/**
 * عقدُ ذاكرةِ المشروعِ التنفيذيّةِ — وحدةُ الحكمِ النقيّةُ لـ`guard:project-state` (‏`WL-329`).
 *
 * **العيبُ الذي تُغلِقُه:** المشروعُ يُنفَّذُ بوكيلٍ واحدٍ في كلِّ مرّةٍ، فإذا نفدَ رصيدُ وكيلٍ
 * جاءَ غيرُه لا يعرفُ ما جرى. وكانت الدورةُ الممكنةُ: وكيلٌ يُعدِّلُ `src/` ويدفعُ وينتهي،
 * ثمّ يأتي آخرُ فيُحدِّثُ الوثائقَ في دفعةٍ لاحقةٍ — وبينهما `main` كودُه متقدِّمٌ على ذاكرتِه.
 * والحواجزُ القائمةُ (‏`status-freshness` · `work-log-ids` · `progress` · `readiness`) تقيسُ
 * **اتّساقَ الوثائقِ فيما بينها** على شجرةٍ واحدةٍ، **ولا تَرى الفرقَ**: كودٌ تغيَّرَ ووثائقُ
 * متّسقةٌ فيما بينها على حالٍ قديمٍ تمرُّ كلُّها خضراءَ.
 *
 * **فهذه الوحدةُ تحكمُ على الفرقِ لا على الشجرةِ:** تُصنِّفُ كلَّ ملفٍّ تغيَّرَ (‏ذاكرةٌ ·
 * محايدٌ · تنفيذيٌّ)، فإن كانَ في الفرقِ تغييرٌ حاملٌ للحالةِ طالبَت بأن تكونَ الحزمةُ نفسُها
 * قد قيَّدَته. والوحدةُ نقيّةٌ: لا تقرأُ قرصاً ولا Git — يُمرَّرُ إليها كلُّ شيءٍ، فتُختبَرُ
 * بكلِّ سيناريو بلا مستودعٍ.
 *
 * **حدٌّ معلَنٌ:** تقيسُ الاقترانَ والأثرَ المُدّعى، لا صدقَ النصِّ (‏المادة 1).
 *
 * @module lib/project-state
 */

/**
 * @typedef {{ path: string, role?: string, affectedBy?: string[] }} MemoryEntry
 * @typedef {{
 *   version: number,
 *   entryPoint: string,
 *   workLog: string,
 *   status: string,
 *   debtRegister: string,
 *   handoff: string,
 *   selfRecords: string[],
 *   memory: MemoryEntry[],
 *   neutral: string[],
 * }} ProjectStateManifest
 * @typedef {{ status: string, path: string }} ChangedFile
 * @typedef {{ id: string, date: string, title: string, body: string }} WorkLogEntry
 * @typedef {{ id: string, closed: boolean, owner: string, line: string, section: string }} DebtRow
 * @typedef {{ code: string, message: string }} Violation
 */

/** حروفُ التشكيلِ والتطويلِ وعلامةُ الاتّجاهِ — تُزالُ قبلَ مطابقةِ العناوينِ العربيّة. */
const ARABIC_MARKS = /[\u064B-\u0652\u0670\u0640\u200E\u200F]/gu;

/**
 * يُطبِّعُ نصّاً عربيّاً للمطابقةِ: بلا تشكيلٍ ولا تطويلٍ ولا علاماتِ اتّجاه.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeArabic(text) {
  return String(text).replace(ARABIC_MARKS, '');
}

/**
 * يُحوِّلُ نمطَ glob بسيطاً إلى تعبيرٍ نمطيٍّ: `**` أيُّ عمقٍ، و`*` داخلَ مقطعٍ واحد.
 * ونمطٌ ينتهي بـ`/` بادئةُ مجلّد.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let source = '';
  const p = pattern.endsWith('/') ? `${pattern}**` : pattern;
  for (let i = 0; i < p.length; i += 1) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        // `**/` يطابقُ صفراً أو أكثرَ من المقاطع، و`**` في الذيلِ يطابقُ أيَّ شيء.
        if (p[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch !== undefined && '\\^$.|?+()[]{}'.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch ?? '';
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

/**
 * هل يطابقُ المسارُ نمطاً من الأنماط؟
 *
 * @param {string} filePath
 * @param {readonly string[]} patterns
 * @returns {boolean}
 */
export function matchesAny(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}

/**
 * يُصنِّفُ مساراً: `memory` إن طابقَ مُدخلةَ ذاكرةٍ، وإلّا `neutral` إن طابقَ المحايدَ،
 * وإلّا `executive` — فالأصلُ تنفيذيٌّ.
 *
 * @param {string} filePath
 * @param {ProjectStateManifest} manifest
 * @returns {'memory' | 'neutral' | 'executive'}
 */
export function classifyPath(filePath, manifest) {
  if (
    matchesAny(
      filePath,
      manifest.memory.map((entry) => entry.path),
    )
  ) {
    return 'memory';
  }
  if (matchesAny(filePath, manifest.neutral)) return 'neutral';
  return 'executive';
}

/**
 * يتحقّقُ من بنيةِ العقدِ ويرمي خطأً مُسمّىً عندَ أوّلِ عيبٍ — فعقدٌ مُعطَّلٌ لا يُقرأُ «فارغاً».
 *
 * @param {unknown} raw
 * @returns {ProjectStateManifest}
 */
export function parseManifest(raw) {
  if (raw === null || typeof raw !== 'object') throw new Error('MANIFEST: ليس كائناً.');
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (m['version'] !== 1) throw new Error('MANIFEST: الإصدارُ ليس 1.');
  for (const key of ['entryPoint', 'workLog', 'status', 'debtRegister', 'handoff']) {
    if (typeof m[key] !== 'string' || String(m[key]).length === 0) {
      throw new Error(`MANIFEST: الحقلُ ${key} غائبٌ أو ليس نصّاً.`);
    }
  }
  for (const key of ['selfRecords', 'neutral']) {
    if (!Array.isArray(m[key]) || !m[key].every((x) => typeof x === 'string')) {
      throw new Error(`MANIFEST: الحقلُ ${key} ليس قائمةَ نصوص.`);
    }
  }
  if (!Array.isArray(m['memory']) || m['memory'].length === 0) {
    throw new Error('MANIFEST: قائمةُ الذاكرةِ فارغةٌ أو غائبة.');
  }
  /** @type {MemoryEntry[]} */
  const memory = [];
  for (const item of m['memory']) {
    const e = /** @type {Record<string, unknown>} */ (item);
    if (typeof e['path'] !== 'string') throw new Error('MANIFEST: مُدخلةُ ذاكرةٍ بلا مسار.');
    const affected = e['affectedBy'];
    if (
      affected !== undefined &&
      (!Array.isArray(affected) || !affected.every((x) => typeof x === 'string'))
    ) {
      throw new Error(`MANIFEST: affectedBy لـ${e['path']} ليس قائمةَ نصوص.`);
    }
    /** @type {MemoryEntry} */
    const entry = { path: e['path'] };
    if (typeof e['role'] === 'string') entry.role = e['role'];
    if (Array.isArray(affected)) entry.affectedBy = /** @type {string[]} */ (affected);
    memory.push(entry);
  }
  const manifest = /** @type {ProjectStateManifest} */ ({
    version: 1,
    entryPoint: String(m['entryPoint']),
    workLog: String(m['workLog']),
    status: String(m['status']),
    debtRegister: String(m['debtRegister']),
    handoff: String(m['handoff']),
    selfRecords: /** @type {string[]} */ (m['selfRecords']),
    memory,
    neutral: /** @type {string[]} */ (m['neutral']),
  });
  for (const key of /** @type {const} */ ([
    'entryPoint',
    'workLog',
    'status',
    'debtRegister',
    'handoff',
  ])) {
    if (classifyPath(manifest[key], manifest) !== 'memory') {
      throw new Error(`MANIFEST: ${key} (${manifest[key]}) ليس مُدرَجاً في الذاكرة.`);
    }
  }
  return manifest;
}

/**
 * يُفكِّكُ سجلَّ الأعمالِ إلى مُدخلاتٍ بقالبِ المادة 6: `### [YYYY-MM-DD] — WL-NNN — العنوان`.
 *
 * @param {string} text
 * @returns {WorkLogEntry[]}
 */
export function parseWorkLog(text) {
  const header = /^###\s*\[(\d{4}-\d{2}-\d{2})\]\s*—\s*(WL-\d{3})\s*—\s*(.*)$/gmu;
  /** @type {{ id: string, date: string, title: string, start: number, bodyStart: number }[]} */
  const marks = [];
  for (const match of String(text).matchAll(header)) {
    const start = match.index ?? 0;
    marks.push({
      id: String(match[2]),
      date: String(match[1]),
      title: String(match[3]),
      start,
      bodyStart: start + match[0].length,
    });
  }
  return marks.map((mark, i) => {
    const next = marks[i + 1];
    const end = next === undefined ? String(text).length : next.start;
    return {
      id: mark.id,
      date: mark.date,
      title: mark.title,
      body: String(text).slice(mark.bodyStart, end),
    };
  });
}

/**
 * مُدخلاتُ الرأسِ التي ليست في الأساسِ — أي ما أضافَته هذه الحزمةُ.
 *
 * @param {string} baseLog
 * @param {string} headLog
 * @returns {WorkLogEntry[]}
 */
export function newWorkLogEntries(baseLog, headLog) {
  const baseIds = new Set(parseWorkLog(baseLog).map((entry) => entry.id));
  return parseWorkLog(headLog).filter((entry) => !baseIds.has(entry.id));
}

/**
 * نصُّ المُدخلةِ كاملاً كما يُقارَنُ: العنوانُ ثمّ المتنُ — بايتاً ببايتٍ بلا تطبيعٍ،
 * فإعادةُ صياغةٍ أو تنسيقٍ تغييرٌ لا تطابق.
 *
 * @param {WorkLogEntry} entry
 * @returns {string}
 */
export function entryText(entry) {
  return `### [${entry.date}] — ${entry.id} — ${entry.title}${entry.body}`;
}

/**
 * يتحقّقُ من إعلاناتِ الاستعادةِ (‏`restored_entries` في `config/work-log-ids.yaml`، `WL-332`).
 *
 * **ما الاستعادةُ وما ليست:** مُدخلةٌ كانت على تاريخِ `main` ثمّ سقطَت، فأُعيدَت **حرفيّاً**.
 * هي ليست عملاً جديداً فلا تُحاكَمُ بـ`PS4`/`PS5`/`PS7` (‏ملفّاتُها تغيَّرَت يومَ قُيِّدَت لا اليوم)،
 * **ولا هي بابُ توثيقٍ لاحقٍ**: النصُّ يجبُ أن يطابقَ بايتاً ببايتٍ نصَّه في كوميتٍ هو **سلفٌ
 * للأساس** — أي قُيِّدَ في وقتِه ودُمِجَ — وأن يُعلِنَها مُدخلةٌ جديدةٌ في الحزمةِ نفسِها.
 *
 * والإعلانُ عن مُدخلةٍ موجودةٍ على الأساسِ **سجلٌّ تاريخيٌّ خاملٌ** لا يُعفي شيئاً.
 *
 * @param {{
 *   declarations: readonly { id?: unknown, from?: unknown, by?: unknown, reason?: unknown }[],
 *   baseWorkLog: string,
 *   headWorkLog: string,
 *   workLogAt: (commit: string) => string | null,
 *   isAncestorOfBase: (commit: string) => boolean,
 * }} input
 * @returns {{ restored: Set<string>, violations: Violation[] }}
 */
export function verifyRestorations(input) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {Set<string>} */
  const restored = new Set();
  const baseIds = new Set(parseWorkLog(input.baseWorkLog).map((e) => e.id));
  const headEntries = parseWorkLog(input.headWorkLog);
  const fresh = headEntries.filter((e) => !baseIds.has(e.id));
  /** @type {{ id: string, by: string }[]} */
  const active = [];
  for (const raw of input.declarations) {
    const id = String(raw?.id ?? '');
    const from = String(raw?.from ?? '');
    const by = String(raw?.by ?? '');
    const reason = String(raw?.reason ?? '').trim();
    if (!/^WL-\d{3}$/u.test(id) || !/^WL-\d{3}$/u.test(by) || from === '' || reason === '') {
      violations.push({
        code: 'PS10/RESTORE-MALFORMED',
        message: `إعلانُ استعادةٍ ناقصٌ (‏\`id\` و\`from\` و\`by\` و\`reason\` شرطٌ): ${JSON.stringify(raw)}`,
      });
      continue;
    }
    if (baseIds.has(id)) continue; // سجلٌّ تاريخيٌّ خاملٌ: المُدخلةُ على الأساسِ فلا إعفاء.
    const head = headEntries.filter((e) => e.id === id);
    if (head.length !== 1) {
      violations.push({
        code: 'PS10/RESTORE-ABSENT',
        message: `\`${id}\` مُعلَنةٌ مُستعادةً وليست في السجلِّ مرّةً واحدةً (‏المقيسُ ${head.length}).`,
      });
      continue;
    }
    if (!input.isAncestorOfBase(from)) {
      violations.push({
        code: 'PS10/RESTORE-NOT-HISTORY',
        message: `مصدرُ استعادةِ \`${id}\` (‏\`${from}\`) ليس سلفاً للأساسِ — لا يُستعادُ إلّا ما دُمِجَ في وقتِه، وإلّا كانَ توثيقاً لاحقاً.`,
      });
      continue;
    }
    const then = parseWorkLog(input.workLogAt(from) ?? '').filter((e) => e.id === id);
    const [was] = then;
    const [now] = head;
    if (
      then.length !== 1 ||
      was === undefined ||
      now === undefined ||
      entryText(was) !== entryText(now)
    ) {
      violations.push({
        code: 'PS10/RESTORE-ALTERED',
        message: `\`${id}\` المُستعادةُ لا تطابقُ نصَّها في \`${from}\` بايتاً ببايتٍ — الاستعادةُ نسخٌ لا إعادةُ كتابة.`,
      });
      continue;
    }
    restored.add(id);
    active.push({ id, by });
  }
  const owners = new Set(fresh.filter((e) => !restored.has(e.id)).map((e) => e.id));
  for (const { id, by } of active) {
    if (!owners.has(by)) {
      violations.push({
        code: 'PS10/RESTORE-UNOWNED',
        message: `استعادةُ \`${id}\` تُعلِنُها \`${by}\` وليست مُدخلةً جديدةً في هذه الحزمة — الاستعادةُ حدثٌ يُقيَّدُ بمُدخلتِه.`,
      });
      restored.delete(id);
    }
  }
  return { restored, violations };
}

/**
 * صورةُ المُدخلةِ للمقارنةِ عبرَ الزمن: نصُّها كاملاً **إلّا ذيلَها** — الفراغُ والفاصلُ `---`
 * اللذانِ يتغيّرانِ حينَ تُضافُ مُدخلةٌ مجاورةٌ (‏قيسَ في إعادةِ تشغيلِ التاريخ: `WL-271` في
 * `75b39aa7`). كلُّ ما سواهما — حرفٌ أو سطرٌ أو ترتيبٌ — تغييرٌ.
 *
 * @param {WorkLogEntry} entry
 * @returns {string}
 */
export function entryFingerprint(entry) {
  return entryText(entry)
    .replace(/(?:\s|^-{3,}$)+$/gmu, '')
    .trimEnd();
}

/**
 * سطورُ «آخر تحديث» في لوحةِ الحالةِ — كلُّ سطرٍ قيدُ حدثٍ، ومعرِّفُه أوّلُ `WL-NNN` فيه.
 *
 * @param {string} text
 * @returns {{ id: string | null, line: string }[]}
 */
export function statusRecords(text) {
  return String(text)
    .split('\n')
    .filter((line) => line.startsWith('آخر تحديث:'))
    .map((line) => ({ id: /WL-\d{3}/u.exec(line)?.[0] ?? null, line }));
}

/**
 * **عدمُ فقدانِ التاريخِ** (‏`WL-334`، `DOC-24`): كلُّ مُدخلةِ سجلٍّ وكلُّ سطرِ «آخر تحديث»
 * على **الأساسِ** يجبُ أن يبقى في **المرشَّحِ** بايتاً ببايتٍ.
 *
 * **لماذا الأساسُ لا الشجرةُ:** `guard:work-log-ids` يقيسُ اتّصالَ الترقيمِ في شجرةٍ واحدةٍ، فإن
 * سقطَت مُدخلةٌ وأُعلِنَ معرِّفُها فجوةً مرَّ (‏هكذا سقطَت `WL-330` في `#255`). هنا السؤالُ: هل
 * يمحو هذا التغييرُ شيئاً كانَ مُثبَتاً قبلَه؟ — والجوابُ لا يتوقّفُ على ملفِّ الاستثناءات.
 *
 * **الإعفاءُ الوحيدُ** إعلانٌ في `history_amendments` (‏`id` · `action: remove|amend` · `by` ·
 * `reason`) **جديدٌ في هذه الحزمةِ** (‏غائبٌ عن ملفِّ الأساس — فإعلانٌ قديمٌ لا يُعفي حذفاً
 * جديداً)، و`by` مُدخلةٌ جديدةٌ فيها. فالحذفُ أو التعديلُ مقصودٌ ومُقيَّدٌ ومُراجَعٌ، لا أثرُ
 * إعادةِ قاعدةٍ أو توليدٍ أو نسخةٍ قديمةٍ من الملفّ.
 *
 * @param {{
 *   baseWorkLog: string,
 *   headWorkLog: string,
 *   baseStatus: string,
 *   headStatus: string,
 *   baseAmendments: readonly unknown[],
 *   headAmendments: readonly unknown[],
 * }} input
 * @returns {{ violations: Violation[], amended: string[] }}
 */
export function verifyHistoryPreserved(input) {
  /** @type {Violation[]} */
  const violations = [];
  const baseEntries = parseWorkLog(input.baseWorkLog);
  const headEntries = parseWorkLog(input.headWorkLog);
  const baseIds = new Set(baseEntries.map((e) => e.id));
  const fresh = new Set(headEntries.filter((e) => !baseIds.has(e.id)).map((e) => e.id));

  /** @param {unknown} raw */
  const key = (raw) => JSON.stringify(raw);
  const inherited = new Set(input.baseAmendments.map(key));
  /** @type {Map<string, Set<string>>} */
  const allowed = new Map();
  for (const raw of input.headAmendments) {
    const item = /** @type {{ id?: unknown, action?: unknown, by?: unknown, reason?: unknown }} */ (
      raw ?? {}
    );
    const id = String(item.id ?? '');
    const action = String(item.action ?? '');
    const by = String(item.by ?? '');
    const reason = String(item.reason ?? '').trim();
    if (
      !/^WL-\d{3}$/u.test(id) ||
      !/^WL-\d{3}$/u.test(by) ||
      !['remove', 'amend'].includes(action) ||
      reason === ''
    ) {
      violations.push({
        code: 'PS13/AMENDMENT-MALFORMED',
        message: `إعلانُ تعديلِ تاريخٍ ناقصٌ (‏\`id\` و\`action: remove|amend\` و\`by\` و\`reason\` شرطٌ): ${key(raw)}`,
      });
      continue;
    }
    if (inherited.has(key(raw))) continue; // إعلانٌ قديمٌ: سجلٌّ لا إعفاءٌ لحذفٍ جديد.
    if (!fresh.has(by)) {
      violations.push({
        code: 'PS13/AMENDMENT-UNOWNED',
        message: `تعديلُ تاريخِ \`${id}\` يُعلِنُه \`${by}\` وليست مُدخلةً جديدةً في هذه الحزمة.`,
      });
      continue;
    }
    const set = allowed.get(id) ?? new Set();
    set.add(action);
    if (action === 'remove') set.add('amend');
    allowed.set(id, set);
  }

  /** @type {Map<string, string[]>} */
  const headTexts = new Map();
  for (const e of headEntries) {
    headTexts.set(e.id, [...(headTexts.get(e.id) ?? []), entryFingerprint(e)]);
  }
  /** @type {Map<string, number>} */
  const baseCounts = new Map();
  for (const e of baseEntries) baseCounts.set(e.id, (baseCounts.get(e.id) ?? 0) + 1);

  for (const [id, count] of baseCounts) {
    const now = headTexts.get(id) ?? [];
    if (now.length < count && !allowed.get(id)?.has('remove')) {
      violations.push({
        code: 'PS11/HISTORY-LOST',
        message:
          `مُدخلةُ \`${id}\` على الأساسِ (‏${count}) غائبةٌ عن المرشَّحِ (‏${now.length}) — ` +
          'تغييرٌ يمحو تقدّماً مُثبَتاً. أعِدْها حرفيّاً، أو أعلِنِ الحذفَ في `history_amendments` بمُدخلةٍ جديدة.',
      });
    }
  }
  for (const e of baseEntries) {
    const now = headTexts.get(e.id) ?? [];
    if (now.length === 0) continue; // حُكِمَ عليه فقداً أعلاه.
    if (!now.includes(entryFingerprint(e)) && !allowed.get(e.id)?.has('amend')) {
      violations.push({
        code: 'PS12/HISTORY-REWRITTEN',
        message:
          `مُدخلةُ \`${e.id}\` أُعيدَت كتابتُها (‏نصُّها على الأساسِ ليس في المرشَّحِ بايتاً ببايتٍ) — ` +
          'المادة 6: التصحيحُ بمُدخلةٍ جديدةٍ، أو إعلانُ `amend` في `history_amendments`.',
      });
    }
  }

  const headLines = new Set(statusRecords(input.headStatus).map((r) => r.line));
  for (const r of statusRecords(input.baseStatus)) {
    if (headLines.has(r.line)) continue;
    if (r.id !== null && allowed.has(r.id)) continue;
    violations.push({
      code: 'PS11/STATUS-HISTORY-LOST',
      message: `سطرُ «آخر تحديث»${r.id === null ? '' : ` لـ\`${r.id}\``} على الأساسِ غائبٌ أو مُعدَّلٌ في المرشَّح: «${r.line.slice(0, 90)}…»`,
    });
  }

  return { violations, amended: [...allowed.keys()] };
}

/**
 * يستخرجُ قسمَ «الملفات المتأثرة» من متنِ مُدخلةٍ: من العنوانِ حتّى العنوانِ التالي.
 *
 * @param {string} body
 * @returns {string | null}
 */
export function affectedFilesSection(body) {
  const lines = String(body).split('\n');
  // ترويسةٌ أو تسميةٌ عريضةٌ في أوّلِ السطرِ وحدَهما — لا ذكرُ القسمِ في نصِّ بندٍ (‏«تُسمّيه «الملفات المتأثرة»»).
  const start = lines.findIndex((line) => {
    const norm = normalizeArabic(line);
    return /^#{2,6}\s+الملفات المتأثرة/u.test(norm) || /^(?:-\s+)?\*\*الملفات المتأثرة/u.test(norm);
  });
  if (start === -1) return null;
  /** @type {string[]} */
  const out = [];
  const first = lines[start] ?? '';
  // صيغةُ السطرِ الواحدِ: «**الملفات المتأثرة:** `a` · `b`».
  if (!/^#{2,6}\s/u.test(first)) out.push(first);
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,6}\s/u.test(line) || /^---\s*$/u.test(line)) break;
    if (/^\*\*[^*]+:?\*\*/u.test(line) && !/الملفات المتأثرة/u.test(normalizeArabic(line))) break;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * يستخرجُ المساراتِ المُعلَنةَ في قسمٍ: كلُّ رمزٍ بينَ علامتَيْ كودٍ يُشبِهُ مساراً
 * (‏فيه `/` أو امتدادٌ، بلا فراغٍ) — بادئةُ مجلّدٍ إن انتهى بـ`/`، ونمطٌ إن حوى `*`.
 *
 * @param {string} section
 * @returns {string[]}
 */
export function declaredPaths(section) {
  /** @type {string[]} */
  const out = [];
  for (const match of String(section).matchAll(/`([^`\s]+)`/gu)) {
    const token = String(match[1]);
    if (
      /^[\w.*-][\w./*@+-]*$/u.test(token) &&
      (token.includes('/') || /\.[A-Za-z][A-Za-z0-9]*$/u.test(token))
    ) {
      // لا معرِّفُ مُدخلةٍ ولا رقمُ إصدارٍ (‏`v0.65.0`) ولا رقم.
      if (!/^WL-\d{3}$/u.test(token) && !/^v?\d/u.test(token)) out.push(token);
    }
  }
  return [...new Set(out)];
}

/**
 * هل يغطّي مسارٌ مُعلَنٌ ملفّاً متغيِّراً؟ تطابقٌ تامٌّ، أو بادئةُ مجلّدٍ، أو نمط.
 *
 * @param {string} declared
 * @param {string} filePath
 * @returns {boolean}
 */
export function covers(declared, filePath) {
  if (declared === filePath) return true;
  if (declared.endsWith('/')) return filePath.startsWith(declared);
  if (declared.includes('*')) return globToRegExp(declared).test(filePath);
  return false;
}

/**
 * يقرأُ صفوفَ سجلِّ الديونِ **من جداولِه المُعرَّفةِ بترويستِها** (‏أوّلُ خليّةٍ «المعرِّف»):
 * المعرِّفُ، والقسمُ، والمالكُ من عمودِ «مَن» إن وُجِدَ (‏وإلّا آخرُ عمودٍ، أو «مالك» في قسمِ
 * ما يُرفَعُ إلى المالك)، و**علامةُ إغلاقٍ صريحةٌ** — معرِّفٌ مشطوبٌ أو 🟢 في الصفّ.
 *
 * **حدٌّ معلَنٌ (‏`DOC-23`):** السجلُّ لا يوحِّدُ علامةَ الإغلاقِ — بعضُ الصفوفِ المُغلَقةِ تُشطَبُ
 * معاييرُها لا معرِّفُها. فغيابُ العلامةِ **لا يعني أنّ الدَّينَ مفتوحٌ**؛ يعني أنّ الصفَّ لا يُعلِنُ
 * إغلاقَه بعلامة. ولذلك لا تقولُ هذه الدالّةُ «مفتوح».
 *
 * @param {string} text
 * @returns {DebtRow[]}
 */
export function parseDebtRows(text) {
  /** @type {DebtRow[]} */
  const rows = [];
  const lines = String(text).split('\n');
  let section = '';
  /** @type {number | null} */
  let ownerColumn = null;
  let inTable = false;
  let ownerSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^#{1,6}\s/u.test(line)) {
      section = line.replace(/^#+\s*/u, '').trim();
      inTable = false;
      continue;
    }
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const next = lines[i + 1] ?? '';
    if (/^\|\s*-{3}/u.test(next)) {
      inTable = normalizeArabic(cells[0] ?? '') === 'المعرف';
      const who = cells.findIndex((c) => normalizeArabic(c) === 'من');
      ownerColumn = who === -1 ? null : who;
      ownerSection = /المالك/u.test(normalizeArabic(section));
      i += 1;
      continue;
    }
    if (!inTable) continue;
    const match = /^(~~)?`([A-Z][A-Z0-9]*(?:[-/][A-Za-z0-9]+)*)`(~~)?/u.exec(cells[0] ?? '');
    if (match === null) continue;
    const last = cells[cells.length - 1] ?? '';
    // صفٌّ يضعُ مالكَه في آخرِ خليّةٍ قصيرةٍ يُقرأُ كما كتبَه، ولو خالفَ ترويسةَ قسمِه.
    const owner =
      ownerColumn !== null
        ? (cells[ownerColumn] ?? '')
        : last.length <= 40
          ? last
          : ownerSection
            ? 'مالك'
            : last;
    rows.push({
      id: String(match[2]),
      closed: match[1] === '~~' || line.includes('🟢'),
      owner,
      line,
      section,
    });
  }
  return rows;
}

/**
 * معرِّفاتُ الديونِ المذكورةُ في عنوانِ مُدخلةٍ (‏بينَ علامتَيْ كودٍ، ولها صفٌّ في السجلّ).
 *
 * @param {string} title
 * @param {readonly DebtRow[]} rows
 * @returns {string[]}
 */
export function debtIdsInTitle(title, rows) {
  const known = new Set(rows.map((row) => row.id));
  /** @type {string[]} */
  const out = [];
  for (const match of String(title).matchAll(/`([^`]+)`/gu)) {
    const token = String(match[1]);
    if (known.has(token)) out.push(token);
  }
  return [...new Set(out)];
}

/**
 * إعلاناتُ «غيرُ متأثِّرٍ» في متنِ مُدخلةٍ: `غير متأثر: \`path\` — سببٌ` (‏السببُ عشرةُ أحرفٍ فأكثر).
 *
 * @param {string} body
 * @returns {Map<string, string>}
 */
export function unaffectedDeclarations(body) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const line of normalizeArabic(body).split('\n')) {
    const match = /غير متأثر\S*\s*:?\s*`([^`]+)`\s*[—–-]+\s*(.+)$/u.exec(line);
    if (match === null) continue;
    const reason = String(match[2]).trim();
    if (reason.length >= 10) out.set(String(match[1]), reason);
  }
  return out;
}

/**
 * الحكمُ على حزمةِ تغييرٍ واحدةٍ (‏الفرقُ بينَ الأساسِ والرأس).
 *
 * القواعدُ — ولكلٍّ رمزٌ يُطبَعُ في الرفضِ:
 *   - `PS1/MISSING`: ملفُّ ذاكرةٍ مُعلَنٌ (‏غيرُ نمطٍ) غائبٌ عن الرأس.
 *   - `PS2/NO-RECORD`: تغييرٌ تنفيذيٌّ أو تغييرُ ذاكرةٍ **بلا مُدخلةِ سجلٍّ جديدةٍ** في الحزمةِ نفسِها.
 *   - `PS3/STATUS-STALE`: تغييرٌ حاملٌ للحالةِ ولوحةُ الحالةِ لم تُحدَّثْ في الحزمة.
 *   - `PS4/UNRECORDED-FILE`: ملفٌّ تنفيذيٌّ أو ذاكرةٌ تغيَّرَ ولا تُسمّيه «الملفات المتأثرة».
 *   - `PS5/PHANTOM-CLAIM`: مسارٌ تُسمّيه «الملفات المتأثرة» ولا أثرَ له في الفرق.
 *   - `PS6/NO-AFFECTED-SECTION`: مُدخلةٌ جديدةٌ بلا قسمِ «الملفات المتأثرة».
 *   - `PS7/DEBT-ROW-STALE`: دَينٌ في عنوانِ المُدخلةِ وصفُّه لا يذكرُها (‏الحالُ «معلَّقٌ» والعملُ تمّ).
 *   - (‏`PS10/RESTORE-*` يُصدِرُها `verifyRestorations`: مُدخلةٌ مُستعادةٌ تُستثنى من هذه القواعدِ
 *     بشرطِ مطابقتِها نصَّها في سلفٍ للأساسِ وإعلانِها بمُدخلةٍ جديدة.)
 *   - `PS8/AFFECTED-DOC-STALE`: وثيقةُ ذاكرةٍ يتأثّرُ ما تصفُه ولم تُحدَّثْ ولم يُعلَنْ أنّها غيرُ متأثّرة.
 *
 * @param {{
 *   manifest: ProjectStateManifest,
 *   changed: readonly ChangedFile[],
 *   headExists: (path: string) => boolean,
 *   baseWorkLog: string,
 *   headWorkLog: string,
 *   headDebtRegister: string,
 *   restored?: ReadonlySet<string>,
 * }} input
 * @returns {{ violations: Violation[], triggered: boolean, executive: string[], memory: string[], newEntries: string[] }}
 */
export function evaluateProjectState(input) {
  const { manifest, changed } = input;
  /** @type {Violation[]} */
  const violations = [];

  for (const entry of manifest.memory) {
    if (!entry.path.includes('*') && !input.headExists(entry.path)) {
      violations.push({
        code: 'PS1/MISSING',
        message: `ملفُّ الذاكرةِ \`${entry.path}\` (${entry.role ?? 'بلا دور'}) غائبٌ عن الشجرة.`,
      });
    }
  }

  const executive = changed
    .filter((f) => classifyPath(f.path, manifest) === 'executive')
    .map((f) => f.path);
  const memory = changed
    .filter((f) => classifyPath(f.path, manifest) === 'memory')
    .map((f) => f.path);
  // تغييرٌ في سجلِّ الأعمالِ وحدَه أو في المولَّداتِ وحدَها لا يُطلِقُ القاعدةَ: هو القيدُ نفسُه.
  const memoryBeyondRecords = memory.filter((p) => !manifest.selfRecords.includes(p));
  const triggered = executive.length > 0 || memoryBeyondRecords.length > 0;
  // المُستعادةُ المُتحقَّقةُ (‏`verifyRestorations`) ليست عملاً جديداً: قُيِّدَت يومَ عُمِلَت.
  const restored = input.restored ?? new Set();
  const entries = newWorkLogEntries(input.baseWorkLog, input.headWorkLog).filter(
    (e) => !restored.has(e.id),
  );

  if (!triggered) {
    return { violations, triggered, executive, memory, newEntries: entries.map((e) => e.id) };
  }

  if (entries.length === 0) {
    const sample = [...executive, ...memoryBeyondRecords]
      .slice(0, 8)
      .map((p) => `\`${p}\``)
      .join(' · ');
    violations.push({
      code: 'PS2/NO-RECORD',
      message:
        `تغييرٌ حاملٌ للحالةِ بلا مُدخلةٍ جديدةٍ في \`${manifest.workLog}\` في الحزمةِ نفسِها: ${sample}` +
        (executive.length + memoryBeyondRecords.length > 8 ? ' …' : '') +
        ' — **لا يُدفَعُ الكودُ وحدَه ولا يُؤجَّلُ قيدُه إلى دفعةٍ لاحقة.**',
    });
  }

  if (!memory.includes(manifest.status)) {
    violations.push({
      code: 'PS3/STATUS-STALE',
      message: `تغييرٌ حاملٌ للحالةِ و\`${manifest.status}\` لم يُحدَّثْ في الحزمةِ نفسِها (‏سطرُ «آخر تحديث» بالمُدخلةِ الجديدة).`,
    });
  }

  if (entries.length > 0) {
    /** @type {string[]} */
    const declared = [];
    for (const entry of entries) {
      const section = affectedFilesSection(entry.body);
      if (section === null) {
        violations.push({
          code: 'PS6/NO-AFFECTED-SECTION',
          message: `المُدخلةُ ${entry.id} بلا قسمِ «الملفات المتأثرة» — قالبُ المادة 6 يَشترطُه.`,
        });
        continue;
      }
      declared.push(...declaredPaths(section));
    }

    const mustCover = [...executive, ...memoryBeyondRecords];
    for (const file of mustCover) {
      if (!declared.some((d) => covers(d, file))) {
        violations.push({
          code: 'PS4/UNRECORDED-FILE',
          message: `\`${file}\` تغيَّرَ ولا تُسمّيه «الملفات المتأثرة» في ${entries.map((e) => e.id).join('/')}.`,
        });
      }
    }
    const allChanged = changed.map((f) => f.path);
    for (const d of new Set(declared)) {
      if (!allChanged.some((file) => covers(d, file))) {
        violations.push({
          code: 'PS5/PHANTOM-CLAIM',
          message: `«الملفات المتأثرة» تُسمّي \`${d}\` ولا أثرَ له في الفرقِ — ادّعاءُ تنفيذٍ بلا أثر.`,
        });
      }
    }

    const rows = parseDebtRows(input.headDebtRegister);
    for (const entry of entries) {
      for (const id of debtIdsInTitle(entry.title, rows)) {
        const row = rows.find((r) => r.id === id);
        if (row !== undefined && !row.line.includes(entry.id)) {
          violations.push({
            code: 'PS7/DEBT-ROW-STALE',
            message: `المُدخلةُ ${entry.id} عن \`${id}\` وصفُّه في \`${manifest.debtRegister}\` لا يذكرُها — السجلُّ يصفُ حالاً قبلَ العمل.`,
          });
        }
      }
    }

    /** @type {Map<string, string>} */
    const unaffected = new Map();
    for (const entry of entries) {
      for (const [k, v] of unaffectedDeclarations(entry.body)) unaffected.set(k, v);
    }
    for (const doc of manifest.memory) {
      if (doc.affectedBy === undefined || doc.affectedBy.length === 0) continue;
      const triggers = executive.filter((file) => matchesAny(file, doc.affectedBy ?? []));
      if (triggers.length === 0) continue;
      if (memory.includes(doc.path) || unaffected.has(doc.path)) continue;
      violations.push({
        code: 'PS8/AFFECTED-DOC-STALE',
        message:
          `\`${doc.path}\` يصفُ ما تغيَّرَ (${triggers
            .slice(0, 3)
            .map((t) => `\`${t}\``)
            .join(' · ')}) ولم يُحدَّثْ — ` +
          `حدِّثْه، أو أعلِنْ في المُدخلةِ: «غيرُ متأثِّرٍ: \`${doc.path}\` — السبب».`,
      });
    }
  }

  return { violations, triggered, executive, memory, newEntries: entries.map((e) => e.id) };
}

/**
 * يُولِّدُ ملخّصَ التسليمِ من مصادرِه وحدَها — نصٌّ حتميٌّ بلا تاريخِ تشغيلٍ ولا Git،
 * فيُقارَنُ بايتاً ببايتٍ ولا يبقى قديماً بصمت.
 *
 * @param {{
 *   manifest: ProjectStateManifest,
 *   workLog: string,
 *   status: string,
 *   debtRegister: string,
 *   externalReview: { findings?: Array<{ id?: string, status?: string }> } | null,
 *   version: { version?: string, completion?: { percent?: number } } | null,
 * }} sources
 * @returns {string}
 */
export function renderHandoff(sources) {
  const entries = parseWorkLog(sources.workLog);
  const sorted = [...entries].sort((a, b) => Number(b.id.slice(3)) - Number(a.id.slice(3)));
  const newest = sorted[0];
  const rows = parseDebtRows(sources.debtRegister);
  const open = rows.filter((r) => !r.closed);
  const closed = rows.filter((r) => r.closed);
  const findings = sources.externalReview?.findings ?? [];
  const openFindings = findings.filter((f) => f.status !== 'closed').map((f) => String(f.id));
  const statusLine =
    String(sources.status)
      .split('\n')
      .find((line) => line.startsWith('آخر تحديث')) ?? '(لا سطرَ «آخر تحديث»)';

  /**
   * @param {WorkLogEntry} entry
   * @returns {string}
   */
  const stateOf = (entry) => {
    const line = normalizeArabic(entry.body)
      .split('\n')
      .find((l) => /الحالة بعد العمل/u.test(l));
    if (line === undefined) return '—';
    const after = line.split(/الحالة بعد العمل:?\*?\*?:?/u)[1] ?? '';
    return after.replace(/\s+/gu, ' ').trim().slice(0, 160) || '—';
  };

  const out = [];
  out.push('# ملخّصُ التسليمِ — ذاكرةُ المشروعِ للوكيلِ التالي');
  out.push('');
  out.push(
    '> ⛔ **مولَّدٌ لا مكتوبٌ بيدٍ:** `npm run handoff:report`، ويقارنُه `npm run guard:project-state`',
  );
  out.push('> بايتاً ببايتٍ — فمن عدَّلَه بيدٍ أو نسيَ توليدَه بعدَ تغييرِ مصادرِه رُدَّت دفعتُه.');
  out.push(
    `> **ومصادرُه:** \`${sources.manifest.workLog}\` · \`${sources.manifest.status}\` · \`${sources.manifest.debtRegister}\``,
  );
  out.push(
    '> · `config/external-review.yaml` · `version.json`. **ورأسُ `main` الحاليُّ من Git لا من هنا:**',
  );
  out.push("> `git fetch origin && git log -1 --format='%H %s' origin/main`.");
  out.push('');
  out.push('## 1 — آخرُ ما جرى');
  out.push('');
  if (newest === undefined) {
    out.push('لا مُدخلةَ في سجلِّ الأعمال.');
  } else {
    out.push(`- **آخرُ مُدخلةٍ:** \`${newest.id}\` (${newest.date})`);
    out.push(
      `- **سطرُ اللوحةِ الأوّلُ:** ${statusLine.replace(/^آخر تحديث:\s*/u, '').slice(0, 400)}`,
    );
  }
  out.push('');
  out.push('| المُدخلةُ | التاريخُ | العنوانُ | الحالةُ بعدَ العملِ |');
  out.push('| --- | --- | --- | --- |');
  for (const entry of sorted.slice(0, 8)) {
    const title = entry.title.replace(/\|/gu, '\\|').slice(0, 180);
    out.push(
      `| \`${entry.id}\` | ${entry.date} | ${title} | ${stateOf(entry).replace(/\|/gu, '\\|')} |`,
    );
  }
  out.push('');
  out.push('## 2 — سجلُّ الديونِ: صفوفٌ بلا علامةِ إغلاقٍ صريحةٍ، بحسبِ القسمِ والمالك');
  out.push('');
  out.push(
    `صفوفٌ في جداولِ المعرِّفاتِ: **${rows.length}** — بعلامةِ إغلاقٍ صريحةٍ (‏مشطوبٌ أو 🟢): **${closed.length}** · ` +
      `بلا علامة: **${open.length}**. **وغيابُ العلامةِ لا يعني «مفتوحاً»** (‏\`DOC-23\`): بعضُ المُغلَقِ يُشطَبُ ` +
      `معيارُه لا معرِّفُه — **فالحكمُ لصفِّه في \`${sources.manifest.debtRegister}\`، فاقرأْه قبلَ العملِ عليه.**`,
  );
  out.push('');
  out.push('| القسمُ | المالكُ (‏كما في الصفّ) | المعرِّفاتُ |');
  out.push('| --- | --- | --- |');
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const row of open) {
    const owner =
      normalizeArabic(row.owner)
        .replace(/\*\*|`/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 48) || '—';
    const key = `${row.section.slice(0, 40)}\u0000${owner}`;
    const list = groups.get(key) ?? [];
    list.push(row.id);
    groups.set(key, list);
  }
  for (const [key, ids] of groups) {
    const [sec, owner] = key.split('\u0000');
    out.push(
      `| ${String(sec).replace(/\|/gu, '\\|')} | ${String(owner).replace(/\|/gu, '\\|')} | ${ids.map((id) => `\`${id}\``).join(' ')} |`,
    );
  }
  out.push('');
  out.push('## 3 — نتائجُ المراجعةِ المستقلّةِ (‏حكمُها للمجلسِ لا للمنفِّذ)');
  out.push('');
  out.push(
    `مفتوحةٌ **${openFindings.length}** من **${findings.length}** في \`config/external-review.yaml\`:`,
  );
  out.push('');
  out.push(openFindings.length === 0 ? '—' : openFindings.map((id) => `\`${id}\``).join(' '));
  out.push('');
  out.push('## 4 — العدّادُ');
  out.push('');
  out.push(
    `\`version.json\`: الإصدارُ \`${sources.version?.version ?? '?'}\` · النسبةُ ${sources.version?.completion?.percent ?? '?'}% — ` +
      '**عدّادُ خطواتٍ محسوبٌ آليّاً لا مقياسُ جاهزيّةٍ ولا اعتماد.**',
  );
  out.push('');
  out.push('## 5 — ما لا يُعادُ تنفيذُه (‏صفوفٌ بعلامةِ إغلاقٍ صريحةٍ في سجلِّ الديون)');
  out.push('');
  out.push(closed.length === 0 ? '—' : closed.map((r) => `\`${r.id}\``).join(' '));
  out.push('');
  return `${out.join('\n')}\n`;
}
