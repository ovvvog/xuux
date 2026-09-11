/**
 * جاهزيّةُ أدواتِ السلسلة — **حضورُ الأداةِ ليس صلاحيتَها** (‏`M10.05`).
 *
 * **العيبُ الذي تُغلقه هذه الوحدة:** كان المجسُّ `probe:docker-present` يُشغِّل
 * أمرَ الاستخبارِ المُعلَنَ للأداةِ (`docker --version`) ويقرأ نجاحَه «حضوراً».
 * وأمرُ الإصدارِ **لا يمسُّ خادمَ الأداةِ أصلاً**: على جهازٍ فيه عميلُ Docker
 * بلا خادمٍ يعمل، يخرج `docker --version` بصفرٍ ويخرج `docker info` بواحدٍ —
 * فيُقرأ حكمُ البيئةِ `healthy` بينما «طريقُ الأمرِ الواحدِ» الذي تُعلنه
 * `config/environment.yaml` نفسُها (‏حاويةُ PostgreSQL في `docker-compose.yml`)
 * **لا يعمل**. وهذا **أخضرُ كاذبٌ من نوعٍ خاصّ**: لا يكذب في القياسِ بل في
 * دلالةِ المقيس — قاسَ وجودَ الملفِّ التنفيذيِّ وقرأه قدرةً على العمل.
 *
 * **العلاجُ: بُعدٌ ثانٍ مُعلَنٌ لا صرامةٌ مُضمَرة.** تُعلن الأداةُ في العقدِ
 * حقلاً اختيارياً `readiness` فيه **أمرُ استخبارٍ ثانٍ** يمسُّ ما تَعِدُ به
 * الأداةُ فعلاً. ومن لم يُعلنه بقيَ حكمُه كما كان بالضبط — الحالةُ
 * `unmeasured` — فلا تُقلَبُ أحكامُ `node` و`npm` بأثرٍ رجعيّ، **ولا يُقرأ
 * غيرُ المقيسِ جاهزاً ولا ساقطاً**.
 *
 * **لماذا أمرٌ ثانٍ لا توسيعُ أمرِ الإصدار:** `docker --version` عقدٌ مع
 * قارئِ الإصدارِ في `versionInRange`، وتغييرُ أرغيومنتاتِه يُفسِد قراءةَ
 * المجالِ المُعلَن. والفصلُ يُبقي لكلِّ سؤالٍ أمرَه: «أيُّ إصدارٍ؟» و«أتعمل؟».
 *
 * **نقاءٌ بنيويّ:** لا `node:fs` ولا `node:child_process` ولا `node:process`
 * هنا — نتيجةُ الأمرِ **تُمرَّر** من `scripts/lib/environment-facts.mjs` وحدَه
 * (‏`R10`). فالوحدةُ التي تحكمُ على جاهزيّةِ أداةٍ لا تملكُ هي أن تُشغِّلَها،
 * ولا أن تُلطِّفَ الحكمَ بتشغيلٍ ثانٍ تختارُ هي شروطَه.
 *
 * @module environment/tool-readiness
 */

/**
 * حالاتُ الجاهزيّةِ الخمسُ لا سادسَ لها؛ وكلُّ حالةٍ تُقرأ وحدَها فلا يُخلَط
 * «لم يُقَس» بـ«قِيس فسقط».
 *
 * - `absent`: الأداةُ غيرُ موجودةٍ في المسار.
 * - `out-of-range`: حاضرةٌ بإصدارٍ خارجَ المجالِ المُعلَن.
 * - `unmeasured`: حاضرةٌ بإصدارٍ مقبولٍ **ولا `readiness` مُعلَنٌ لها** — فلا
 *   يُدَّعى عليها جاهزيّةٌ ولا يُنقَص حكمُها بما لم يُقَس.
 * - `present-unready`: حاضرةٌ بإصدارٍ مقبولٍ **وأمرُ جاهزيّتِها المُعلَنُ أخفق**
 *   — وهذه عينُ الحالةِ التي كانت تُقرأ نجاحاً.
 * - `ready`: حاضرةٌ وأمرُ جاهزيّتِها المُعلَنُ نجح.
 */
export const READINESS_STATES = Object.freeze([
  'absent',
  'out-of-range',
  'unmeasured',
  'present-unready',
  'ready',
]);

/** الحالاتُ التي يُقرأ معها المجسُّ مستوفىً — مصدرٌ واحدٌ لا شرطٌ يُعاد في كلِّ فرع. */
const SATISFYING_STATES = Object.freeze(['unmeasured', 'ready']);

/**
 * @param {string} state
 * @param {string} detail
 * @returns {ReadinessJudgement}
 */
function verdict(state, detail) {
  return { state, satisfied: SATISFYING_STATES.includes(state), detail };
}

/**
 * @typedef {object} ToolReadinessSpec
 * @property {string[]} args أرغيوماتُ أمرِ الاستخبارِ الثاني.
 * @property {string} statement لماذا هذا الأمرُ بعينِه يُقاس به العملُ لا الحضور.
 */

/**
 * واقعةُ تشغيلٍ **مُمرَّرةٌ** من جامعِ الوقائع.
 *
 * @typedef {object} ToolOutcome
 * @property {boolean} present
 * @property {boolean} inRange
 * @property {string | null} [version]
 * @property {{ ok: boolean, observed: string | null }} [readiness]
 */

/**
 * @typedef {object} ReadinessJudgement
 * @property {string} state إحدى `READINESS_STATES`.
 * @property {boolean} satisfied
 * @property {string} detail نصٌّ للقراءةِ يُسمّي السببَ لا يُلمِّح إليه.
 */

/**
 * هل تُعلن هذه الأداةُ أمرَ جاهزيّةٍ ثانياً؟
 *
 * @param {{ command: string, readiness?: ToolReadinessSpec }} tool
 * @returns {boolean}
 */
export function declaresReadiness(tool) {
  return (
    tool.readiness !== undefined &&
    Array.isArray(tool.readiness.args) &&
    tool.readiness.args.length > 0
  );
}

/**
 * نصُّ أمرِ الجاهزيّةِ كما يُكتب في الوثيقةِ وفي المخرَج — موضعُ توليدٍ واحدٌ
 * كي لا تختلف صيغتُه بين الحاجزِ والوثيقةِ فيُقرأ الاختلافُ مخالفةً.
 *
 * @param {{ command: string, readiness?: ToolReadinessSpec }} tool
 * @returns {string}
 */
export function readinessCommandText(tool) {
  if (!declaresReadiness(tool)) return '';
  const spec = /** @type {ToolReadinessSpec} */ (tool.readiness);
  return [tool.command, ...spec.args].join(' ');
}

/**
 * الحكمُ على جاهزيّةِ أداةٍ من واقعةٍ مُمرَّرة.
 *
 * @param {{ id: string, command: string, minMajor?: number, maxMajor?: number, readiness?: ToolReadinessSpec }} tool
 * @param {ToolOutcome} outcome
 * @returns {ReadinessJudgement}
 */
export function judgeToolReadiness(tool, outcome) {
  if (!outcome.present) {
    return verdict('absent', `الأداةُ «${tool.command}» غيرُ موجودةٍ في المسارِ.`);
  }
  if (!outcome.inRange) {
    return verdict(
      'out-of-range',
      `الأداةُ «${tool.command}» حاضرةٌ بإصدارٍ خارجَ المجالِ المُعلَنِ (${String(tool.minMajor ?? '—')}..${String(tool.maxMajor ?? '—')}).`,
    );
  }
  if (!declaresReadiness(tool)) {
    return verdict(
      'unmeasured',
      `الأداةُ «${tool.command}» حاضرةٌ بإصدارٍ داخلَ المجالِ المُعلَنِ.`,
    );
  }
  const readiness = outcome.readiness;
  if (readiness === undefined) {
    return verdict(
      'present-unready',
      `الأداةُ «${tool.command}» حاضرةٌ، وأمرُ جاهزيّتِها المُعلَنُ «${readinessCommandText(tool)}» لم يُشغَّل — وجاهزيّةٌ مُعلَنةٌ ولم تُقَسْ لا تُقرأ جاهزيّةً.`,
    );
  }
  if (!readiness.ok) {
    return verdict(
      'present-unready',
      `الأداةُ «${tool.command}» حاضرةٌ ولا تعمل: أمرُ جاهزيّتِها المُعلَنُ «${readinessCommandText(tool)}» أخفق — والحضورُ في المسارِ ليس قدرةً على العمل.`,
    );
  }
  return verdict(
    'ready',
    `الأداةُ «${tool.command}» حاضرةٌ بإصدارٍ داخلَ المجالِ المُعلَنِ وعاملةٌ بأمرِ جاهزيّتِها المُعلَن.`,
  );
}

/**
 * الأدواتُ التي تُعلن جاهزيّةً — بترتيبِ العقدِ لا بترتيبٍ يُختار هنا.
 *
 * @param {{ toolchain: { id: string, command: string, readiness?: ToolReadinessSpec }[] }} contract
 * @returns {{ id: string, command: string, readiness: ToolReadinessSpec }[]}
 */
export function toolsDeclaringReadiness(contract) {
  return contract.toolchain
    .filter((tool) => declaresReadiness(tool))
    .map((tool) => ({
      id: tool.id,
      command: tool.command,
      readiness: /** @type {ToolReadinessSpec} */ (tool.readiness),
    }));
}

/**
 * @typedef {object} ReadinessSurfaceAudit
 * @property {string[]} undeclared أدواتٌ تُعلن جاهزيّةً في العقدِ ولا مُدخلةَ لها في الوثيقة.
 * @property {string[]} stale مُدخلاتٌ في الوثيقةِ لأداةٍ لم تعد تُعلن جاهزيّةً.
 * @property {{ tool: string, contract: string, documented: string }[]} mismatched أمرٌ مكتوبٌ في الوثيقةِ يخالف أمرَ العقد.
 * @property {number} measured عددُ الأدواتِ المقيسةِ فعلاً.
 */

/**
 * مقايسةُ ما يُعلنه العقدُ بما تُعلنه الوثيقةُ **في الاتجاهين**.
 *
 * والاتجاهُ الثاني ليس زينةً: مُدخلةٌ تبقى في الوثيقةِ بعدَ زوالِ سببِها تُعلِّم
 * القارئَ أنّ أداةً تُقاس جاهزيّتُها وهي لا تُقاس — وذلك أسوأُ من صمتٍ، لأنّ
 * القارئَ يبني عليه.
 *
 * @param {{ tools: { id: string, command: string, readiness: ToolReadinessSpec }[], documented: { tool: string, command: string }[] }} input
 * @returns {ReadinessSurfaceAudit}
 */
export function auditReadinessSurface(input) {
  const documented = new Map(input.documented.map((entry) => [entry.tool, entry.command]));
  const declared = new Map(input.tools.map((tool) => [tool.id, readinessCommandText(tool)]));
  /** @type {string[]} */
  const undeclared = [];
  /** @type {{ tool: string, contract: string, documented: string }[]} */
  const mismatched = [];
  for (const [id, command] of declared) {
    const inDoc = documented.get(id);
    if (inDoc === undefined) {
      undeclared.push(id);
      continue;
    }
    if (inDoc.trim() !== command) {
      mismatched.push({ tool: id, contract: command, documented: inDoc.trim() });
    }
  }
  const stale = [...documented.keys()].filter((id) => !declared.has(id));
  return { undeclared, stale, mismatched, measured: declared.size };
}
