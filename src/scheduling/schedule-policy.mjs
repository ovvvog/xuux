/**
 * قيودُ الجدولةِ المُعلَنةُ وحسابُ الشقوقِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
 *
 * **العيبُ الذي تُغلقُه هذه الوحدةُ، بنصِّه كما كان:** «لا مُجدوِلَ ذاتيَّ
 * التشغيلِ في المستودعِ. التقاريرُ والتمارينُ تُطلَقُ بنداءٍ يدويٍّ، والدوريّةُ
 * عهدٌ في وثيقةٍ لا فعلٌ يقعُ». وكانت `src/recovery/schedule.mjs` تقيسُ **فواتَ**
 * التجربةِ من الدفترِ ولا تُطلقُها؛ فالدولةُ كانت تعرفُ أنّها متأخّرةٌ ولا تفعلُ
 * شيئاً — وعلمٌ بالتأخّرِ بلا فعلٍ ليس جدولةً بل توثيقُ إهمالٍ.
 *
 * وهذه الوحدةُ **بياناتٌ وحسابٌ لا تشغيلٌ**: تحمّلُ `config/schedule.yaml`،
 * وتتحقّقُ منه ضدَّ مخطَّطِه، ثمّ تفحصُ تماسكَه مع حزمةِ السياسةِ:
 *
 *  1. كلُّ فعلٍ يُعلِنُه عملٌ في `performs` **موجودٌ** في فهرسِ الأفعالِ
 *     المحكومةِ — فعلٌ مخترعٌ يمرُّ بلا قرارٍ لأنّ لا سياسةَ تعرفُه.
 *  2. **لا فعلَ فوقَ العتبةِ السياديّةِ يُجدوَلُ.** المُجدوِلُ لا يحملُ أمراً
 *     ملكيّاً، وجدولةُ فعلٍ فوقَ العتبةِ إمّا تفشلُ كلَّ مرّةٍ (فجدولةٌ صوريّةٌ)،
 *     أو تُمرِّرُ أمراً محفوظاً في تركيبٍ — وأمرٌ ملكيٌّ محفوظٌ للتكرارِ ليس
 *     أمراً، بل مفتاحٌ دائمٌ بيدِ عمليّةٍ تعملُ بلا حاضرٍ.
 *  3. **نبضُ المُجدوِلِ لا يطولُ عن أقصرِ دوريّةٍ.** نبضٌ أطولُ يجعلُ العملَ
 *     يتأخّرُ بمقدارِ النبضِ حتماً؛ ويُرفَضُ عندَ التحميلِ لا يكتشفُه المُشغِّلُ
 *     من فواتٍ بعدَ أسبوعٍ.
 *  4. **المَهَلُ لا يطولُ عن الدوريّةِ.** مَهَلٌ أطولُ يجعلُ نافذةَ السماحِ
 *     تتجاوزُ الشقَّ التالي، فلا يُعلَنُ فواتٌ أبداً — وسماحٌ لا ينتهي ليس مَهَلاً.
 *  5. **دورُ العملِ يبلغُ فعلَ الإطلاقِ بسياسةٍ نافذةٍ.** عملٌ بدورٍ لا سياسةَ
 *     تسمحُ له بـ`run-scheduled-job` جدولةٌ تُرفَضُ في كلِّ نبضةٍ، والأَولى
 *     رفضُها مرّةً عندَ التحميلِ.
 *
 * @module scheduling/schedule-policy
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

import { SCHEDULER_ERRORS, SchedulerError } from './errors.mjs';
import { SCHEDULER_DISPATCH_ACTION } from './scheduler.mjs';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** مجلدُ الإعداداتِ الافتراضيُّ. */
export const DEFAULT_SCHEDULE_CONFIG_DIR = path.join(ROOT, 'config');

// فعلُ الإطلاقِ المحكومُ **مُعرَّفٌ في الموضعِ الذي يُفوِّضُه** (`scheduler.mjs`)
// ويُقرأُ هنا رمزاً لا نصّاً: اسمُ فعلٍ محكومٍ مكتوبٌ نصّاً في وحدةٍ لا تمرُّ
// بنقطةِ التفويضِ فعلٌ حسّاسٌ يُسمّى من مكانٍ لا يُقرِّرُ — وحاجزُ التفويضِ
// (`guard:authorization` قاعدةُ `R2`) يرفضُه. وهي سُنّةُ `PURGE_ACTION` نفسُها.

const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;

/**
 * @typedef {object} ScheduledJobShape
 * @property {string} id
 * @property {string} subject
 * @property {'report' | 'drill'} kind
 * @property {{ everyHours: number, graceHours: number }} cadence
 * @property {string} actorRole
 * @property {string[]} performs
 */

/**
 * @typedef {object} SchedulePolicyShape
 * @property {number} version
 * @property {{ everyMinutes: number, maxJobsPerTick: number }} tick
 * @property {ScheduledJobShape[]} jobs
 */

/** عملٌ مُجدوَلٌ مُعلَنٌ ومُتحقَّقٌ منه. */
export class ScheduledJob {
  /** @param {ScheduledJobShape} shape */
  constructor(shape) {
    this.id = shape.id;
    this.subject = shape.subject;
    this.kind = shape.kind;
    this.cadence = Object.freeze({ ...shape.cadence });
    this.actorRole = shape.actorRole;
    this.performs = Object.freeze([...shape.performs]);
    Object.freeze(this);
  }

  /** طولُ الشقِّ بالميلي ثانية. */
  get everyMs() {
    return this.cadence.everyHours * MS_PER_HOUR;
  }

  /** نافذةُ السماحِ بالميلي ثانية. */
  get graceMs() {
    return this.cadence.graceHours * MS_PER_HOUR;
  }

  /**
   * بدايةُ الشقِّ الذي تقعُ فيه لحظةُ الآنِ.
   *
   * والشقوقُ **شبكةٌ ثابتةٌ محسوبةٌ من مبدأِ الزمنِ** (`floor(now / everyMs)`)
   * لا فترةٌ تُحسبُ من آخرِ تشغيلٍ. والسببُ أنّ الحسابَ من آخرِ تشغيلٍ يجعلُ
   * تأخّراً واحداً يزحفُ بالمواعيدِ كلِّها إلى الأمامِ بلا نهايةٍ، ويجعلُ
   * مُعرِّفَ الشقِّ يعتمدُ على تاريخِ العمليّةِ فلا يصلحُ قفلاً بين عمليّتَينِ.
   * وبالشبكةِ الثابتةِ يكونُ لكلِّ شقٍّ اسمٌ واحدٌ تعرفُه كلُّ نسخةٍ.
   *
   * @param {number} now
   * @returns {number}
   */
  slotAt(now) {
    assertClock(now);
    return Math.floor(now / this.everyMs) * this.everyMs;
  }
}

/** قيودُ جدولةٍ محمَّلةٌ ومُتحقَّقٌ منها. */
export class SchedulePolicy {
  /** @param {SchedulePolicyShape} shape */
  constructor(shape) {
    this.version = shape.version;
    this.tick = Object.freeze({ ...shape.tick });
    /** @type {ReadonlyArray<ScheduledJob>} */
    this.jobs = Object.freeze(shape.jobs.map((job) => new ScheduledJob(job)));
    /** @type {ReadonlyMap<string, ScheduledJob>} */
    this.byId = Object.freeze(new Map(this.jobs.map((job) => [job.id, job])));
    Object.freeze(this);
  }

  /** فترةُ النبضِ بالميلي ثانية. */
  get tickMs() {
    return this.tick.everyMinutes * MS_PER_MINUTE;
  }

  /**
   * عملٌ باسمِه، ورفضٌ مُسمّى لما ليس معلَناً: عملٌ يُطلَقُ وليس في القيودِ
   * جدولةٌ خارجَ البياناتِ.
   * @param {string} jobId
   * @returns {ScheduledJob}
   */
  job(jobId) {
    const job = this.byId.get(jobId);
    if (job === undefined) {
      throw new SchedulerError(
        SCHEDULER_ERRORS.JOB_UNKNOWN,
        `لا عملَ مُجدوَلاً باسمِ «${jobId}» في القيودِ المُعلَنةِ؛ وعملٌ يُطلَقُ بلا إعلانٍ جدولةٌ خارجَ البياناتِ.`,
        { jobId },
      );
    }
    return job;
  }
}

/**
 * @param {number} value
 * @returns {void}
 */
function assertClock(value) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new SchedulerError(
      SCHEDULER_ERRORS.CLOCK_INVALID,
      'لحظةُ الآنِ ليست عدداً صحيحاً منتهياً — وساعةٌ لا تُصدرُ عدداً لا يُبنى عليها شقٌّ ولا موعدٌ.',
      { now: value },
    );
  }
}

/**
 * @param {string} dir
 * @returns {unknown}
 */
function readScheduleConfig(dir) {
  const file = path.join(dir, 'schedule.yaml');
  if (!fs.existsSync(file)) {
    throw new SchedulerError(
      SCHEDULER_ERRORS.CONFIG_INVALID,
      `قيودُ الجدولةِ مفقودةٌ: ${file}. ومُجدوِلٌ بلا قيودٍ مُعلَنةٍ يعودُ إلى مواعيدَ في الكودِ، وهي التي أُخرجَ منها.`,
      { file },
    );
  }
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * @typedef {object} PolicyBundleView
 * @property {ReadonlyMap<string, { id: string }>} actions
 * @property {ReadonlyMap<string, unknown>} roles
 * @property {ReadonlyArray<{ action: string, delegable?: boolean }>} threshold
 * @property {ReadonlyArray<{ id: string, enabled?: boolean, effect: string, actions: ReadonlyArray<string>, actors: { roles?: ReadonlyArray<string> } }>} policies
 */

/**
 * يحمّلُ قيودَ الجدولةِ ويتحقّقُ منها ضدَّ مخطَّطها، ثمّ يفحصُ تماسكَها مع حزمةِ
 * السياسةِ. والحزمةُ **مطلوبةٌ لا اختياريّةٌ**: بلا فهرسِ الأفعالِ والعتبةِ
 * السياديّةِ يصيرُ الفحصُ نحوياً، ويمرُّ عملٌ يُجدوِلُ فعلاً سياديّاً.
 *
 * @param {{ dir?: string, bundle: PolicyBundleView }} options
 * @returns {SchedulePolicy}
 */
export function loadSchedulePolicy({ dir = DEFAULT_SCHEDULE_CONFIG_DIR, bundle }) {
  if (bundle === undefined || bundle === null || typeof bundle.actions?.has !== 'function') {
    throw new SchedulerError(
      SCHEDULER_ERRORS.CONFIG_INVALID,
      'تحميلُ قيودِ الجدولةِ يلزمُه حزمةُ السياسةِ: بلا فهرسِ الأفعالِ والعتبةِ السياديّةِ يكونُ الفحصُ نحوياً، فيمرُّ عملٌ يُجدوِلُ فعلاً فوقَ العتبةِ.',
    );
  }
  const raw = readScheduleConfig(dir);
  const schemaFile = path.join(dir, 'schemas', 'schedule.schema.json');
  if (!fs.existsSync(schemaFile)) {
    throw new SchedulerError(
      SCHEDULER_ERRORS.CONFIG_INVALID,
      `مخطَّطُ قيودِ الجدولةِ مفقودٌ: ${schemaFile}.`,
      { schemaFile },
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaFile, 'utf8')));
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
      .join('؛ ');
    throw new SchedulerError(
      SCHEDULER_ERRORS.CONFIG_INVALID,
      `قيودُ الجدولةِ لا تطابقُ مخطَّطها: ${detail}`,
    );
  }
  const parsed = /** @type {SchedulePolicyShape} */ (raw);

  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  const sovereign = new Set(
    (bundle.threshold ?? []).filter((entry) => entry.delegable !== true).map((e) => e.action),
  );

  if (!bundle.actions.has(SCHEDULER_DISPATCH_ACTION)) {
    problems.push(
      `فعلُ الإطلاقِ «${SCHEDULER_DISPATCH_ACTION}» غيرُ معلَنٍ في فهرسِ الأفعالِ؛ فكلُّ إطلاقٍ كان سيُرفَضُ بفعلٍ مجهولٍ.`,
    );
  }
  if (sovereign.has(SCHEDULER_DISPATCH_ACTION)) {
    problems.push(
      `فعلُ الإطلاقِ «${SCHEDULER_DISPATCH_ACTION}» فوقَ العتبةِ السياديّةِ؛ فلا يقعُ إطلاقٌ بلا أمرٍ ملكيٍّ، والمُجدوِلُ لا يحملُ أمراً.`,
    );
  }

  const allowingRoles = new Set(
    (bundle.policies ?? [])
      .filter(
        (policy) =>
          policy.enabled === true &&
          policy.effect === 'allow' &&
          Array.isArray(policy.actions) &&
          policy.actions.includes(SCHEDULER_DISPATCH_ACTION),
      )
      .flatMap((policy) => policy.actors?.roles ?? []),
  );

  const shortestEveryMs = Math.min(
    ...parsed.jobs.map((job) => job.cadence.everyHours * MS_PER_HOUR),
  );
  if (parsed.tick.everyMinutes * MS_PER_MINUTE > shortestEveryMs) {
    problems.push(
      `نبضُ المُجدوِلِ (${parsed.tick.everyMinutes} دقيقةً) أطولُ من أقصرِ دوريّةٍ (${shortestEveryMs / MS_PER_HOUR} ساعةً)؛ فالعملُ يتأخّرُ عن موعدِه بمقدارِ النبضِ حتماً.`,
    );
  }

  for (const job of parsed.jobs) {
    if (seen.has(job.id)) {
      problems.push(
        `عملٌ مُكرَّرٌ: ${job.id} — معرِّفٌ واحدٌ لعملَينِ يجعلُ قفلَ الشقِّ يخلطُ بينهما.`,
      );
    }
    seen.add(job.id);
    if (!bundle.roles.has(job.actorRole)) {
      problems.push(`العملُ ${job.id} يُعلِنُ دوراً غيرَ مسجَّلٍ: ${job.actorRole}.`);
    } else if (!allowingRoles.has(job.actorRole)) {
      problems.push(
        `العملُ ${job.id} بدورِ ${job.actorRole} ولا سياسةَ نافذةً تسمحُ لهذا الدورِ بـ«${SCHEDULER_DISPATCH_ACTION}»؛ فجدولتُه تُرفَضُ في كلِّ نبضةٍ.`,
      );
    }
    if (job.cadence.graceHours > job.cadence.everyHours) {
      problems.push(
        `العملُ ${job.id}: المَهَلُ (${job.cadence.graceHours}س) أطولُ من الدوريّةِ (${job.cadence.everyHours}س)؛ فنافذةُ السماحِ تتجاوزُ الشقَّ التالي ولا يُعلَنُ فواتٌ أبداً.`,
      );
    }
    for (const action of job.performs) {
      if (!bundle.actions.has(action)) {
        problems.push(`العملُ ${job.id} يُعلِنُ فعلاً غيرَ موجودٍ في فهرسِ الأفعالِ: «${action}».`);
      }
      if (sovereign.has(action)) {
        problems.push(
          `${SCHEDULER_ERRORS.SOVEREIGN_ACTION_NOT_SCHEDULABLE}: العملُ ${job.id} يُعلِنُ الفعلَ «${action}» وهو فوقَ العتبةِ السياديّةِ؛ ولا يُجدوَلُ فعلٌ فوقَ العتبةِ لأنّ المُجدوِلَ لا يحملُ أمراً ملكيّاً.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new SchedulerError(
      SCHEDULER_ERRORS.CONFIG_INVALID,
      `قيودُ الجدولةِ غيرُ متماسكةٍ: ${problems.join(' | ')}`,
      { problems },
    );
  }
  return new SchedulePolicy(parsed);
}
