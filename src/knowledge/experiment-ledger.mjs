/**
 * سجل التجارب ومعايير المعرفة — الخطوة M7.08.
 *
 * العيبُ الذي يُغلقه: سجلُّ تقييم النماذج (‏`M6.08`) كان يقبل نتيجةً لأي نموذجٍ
 * وأيِّ بصمةٍ **بلا سند**: لا فرضيةَ مُعلَنة، ولا مقاييسَ مُسجَّلة قبل رؤية
 * الأرقام، ولا بذرةَ ولا تجزئةَ بياناتٍ ولا مراجعةَ شيفرةٍ ولا بيئةً تُعيد
 * إنتاجَ الدرجة، ولا مُجرٍ يُسأل. فكان «النموذجُ اجتاز التقييم» جملةً لا يقابلها
 * شيءٌ يُقرأ — **والانتقاءُ اللاحق للمقاييس** (اشتقاقُ معيار الحكم بعد رؤية
 * النتيجة) لا يُكشف أصلاً لأن المعيار لم يكن مكتوباً قبلها.
 *
 * والحلُّ ليس وثيقةَ إرشاد: المعاييرُ الأربعة بنودٌ في `config/knowledge.yaml`،
 * **ولكل بندٍ رمزُ رفضٍ يقع فعلاً** في هذه الوحدة أو في وحدةِ الإنفاذ المسمّاة
 * معه — يحرس الرابطةَ `npm run guard:knowledge`. والقيدُ يُكتب **قبل** أن تُجرى
 * التجربة، فسندُ النتيجة أسبقُ منها في الزمن لا لاحقٌ لها.
 *
 * حدودٌ معلَنة:
 *   1. المخزنُ ملفُّ JSON ذرّيٌّ (أو ذاكرةٌ للاختبار) **لا جدولُ PostgreSQL** —
 *      كسجل التقييم الذي يحرسه بالضبط، ولأن `ModelEvaluationLedger.record`
 *      **متزامنة** ولا يجوز أن يحوّلها حارسٌ إلى غير متزامنةٍ في مسارٍ يمرّ به
 *      تنشيطُ النموذج. ونقلُ السجلَّين معاً إلى القاعدة دَينٌ مكتوبٌ من `M6.08`.
 *   2. الحقولُ تُقاس **حضوراً وصيغةً لا صدقاً**: لا شيء يتحقّق أن `datasetHash`
 *      تجزئةُ البياناتِ المستعملة فعلاً، ولا أن `codeRevision` هو ما شُغِّل.
 *   3. سلسلةُ التجزئة **تكشف العبثَ ولا تمنعه**: لا مُطلِقَ في قاعدةٍ ولا ملفَّ
 *      لا يُكتب عليه.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020Default from 'ajv/dist/2020.js';

const Ajv2020 = /** @type {typeof import('ajv/dist/2020.js').Ajv2020} */ (
  /** @type {unknown} */ (Ajv2020Default)
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_KNOWLEDGE_CONFIG_DIR = path.join(ROOT, 'config');

/** أوّلُ وصلةٍ في السلسلة: قيمةٌ مُعلَنة لا سلسلةٌ فارغة تُقرأ «لا سابقَ له». */
export const EXPERIMENT_GENESIS = 'genesis';

export const KNOWLEDGE_ERRORS = Object.freeze({
  CONFIG_INVALID: 'KNOWLEDGE_CONFIG_INVALID',
  INPUT_INVALID: 'KNOWLEDGE_INPUT_INVALID',
  KIND_UNKNOWN: 'KNOWLEDGE_KIND_UNKNOWN',
  EXPERIMENT_UNREGISTERED: 'KNOWLEDGE_EXPERIMENT_UNREGISTERED',
  SUBJECT_MISMATCH: 'KNOWLEDGE_SUBJECT_MISMATCH',
  REPRODUCIBILITY_INCOMPLETE: 'KNOWLEDGE_REPRODUCIBILITY_INCOMPLETE',
  HYPOTHESIS_MISSING: 'KNOWLEDGE_HYPOTHESIS_MISSING',
  METRIC_UNDECLARED: 'KNOWLEDGE_METRIC_UNDECLARED',
  SELF_REVIEW_REFUSED: 'KNOWLEDGE_SELF_REVIEW_REFUSED',
  REGISTER_REFUSED: 'KNOWLEDGE_REGISTER_REFUSED',
  REVIEW_REFUSED: 'KNOWLEDGE_REVIEW_REFUSED',
  FORBIDDEN_FIELD: 'KNOWLEDGE_FORBIDDEN_FIELD',
  CHAIN_BROKEN: 'KNOWLEDGE_CHAIN_BROKEN',
  ALREADY_CONCLUDED: 'KNOWLEDGE_ALREADY_CONCLUDED',
  STORAGE_INVALID: 'KNOWLEDGE_STORAGE_INVALID',
});

/** خطأٌ مُسمّى: الرمزُ للأتمتة، والنصُّ العربي لمن يقرأ سببَ الرفض. */
export class KnowledgeError extends Error {
  /**
   * @param {string} code
   * @param {string} detail
   */
  constructor(code, detail) {
    super(detail);
    this.name = 'KnowledgeError';
    /** @type {string} */
    this.code = code;
    /** @type {string} */
    this.detail = detail;
  }
}

/**
 * @typedef {object} KnowledgeClause
 * @property {string} id
 * @property {string} rule
 * @property {string} code
 */

/**
 * @typedef {object} KnowledgeStandard
 * @property {string} id
 * @property {string} title
 * @property {string} document
 * @property {readonly string[]} enforcedBy
 * @property {readonly KnowledgeClause[]} clauses
 */

/**
 * @typedef {object} ExperimentKind
 * @property {string} id
 * @property {string} subject
 * @property {readonly string[]} subjectKeys
 * @property {string | null} boundTo
 * @property {string | null} reason
 */

/**
 * @typedef {object} KnowledgePolicy
 * @property {number} version
 * @property {string} owner
 * @property {readonly KnowledgeStandard[]} standards
 * @property {readonly ExperimentKind[]} experimentKinds
 * @property {{ requiredFields: readonly string[], minHexLength: number }} reproducibility
 * @property {{ requireHypothesis: boolean, minHypothesisLength: number, requirePreregisteredMetrics: boolean, forbidSelfReview: boolean, forbiddenFields: readonly string[] }} integrity
 * @property {{ registrars: readonly string[], reviewers: readonly string[] }} roles
 * @property {readonly string[]} ledgerHolders
 * @property {(id: string) => ExperimentKind | null} kindFor
 */

/**
 * @typedef {object} ExperimentRecord
 * @property {string} id
 * @property {number} seq
 * @property {string} kind
 * @property {string} title
 * @property {string} hypothesis
 * @property {readonly string[]} metrics
 * @property {Record<string, string>} subject
 * @property {{ seed: string, datasetHash: string, codeRevision: string, environment: string }} reproducibility
 * @property {string} registeredBy
 * @property {string} registeredByRole
 * @property {string} registeredAt
 * @property {string | null} outcome
 * @property {Record<string, number> | null} results
 * @property {string | null} concludedBy
 * @property {string | null} concludedAt
 * @property {string | null} reviewedBy
 * @property {string | null} reviewedAt
 * @property {string} prevHash
 * @property {string} hash
 */

/** @param {unknown} error @returns {string} */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * يقرأ سياسةَ المعرفة ويتحقّق من مخطَّطها ثم من التماسك الذي لا يصفه المخطَّط:
 * لا معيارَ مكرَّراً، ولا نوعَ تجربةٍ مكرَّراً، **ولا نوعاً بلا ارتباطٍ وبلا سبب**
 * (فالسكوتُ عن سبب الغياب هو ما يجعل الغيابَ يدوم)، ولا حقلَ إعادةِ إنتاجٍ
 * مذكوراً في الواجبات وغيرَ مقروءٍ في النوع.
 * @param {{ dir?: string }} [options]
 * @returns {KnowledgePolicy}
 */
export function loadKnowledgePolicy(options = {}) {
  const dir = options.dir ?? DEFAULT_KNOWLEDGE_CONFIG_DIR;
  const schemaDir = fs.existsSync(path.join(dir, 'schemas')) ? dir : DEFAULT_KNOWLEDGE_CONFIG_DIR;
  const file = path.join(dir, 'knowledge.yaml');
  if (!fs.existsSync(file)) {
    throw new KnowledgeError(
      KNOWLEDGE_ERRORS.CONFIG_INVALID,
      'ملف سياسة المعرفة غائب؛ ومعاييرُ بلا ملفٍ محكومٍ نصوصٌ حرّة.',
    );
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new KnowledgeError(
      KNOWLEDGE_ERRORS.CONFIG_INVALID,
      `تعذّرت قراءة knowledge.yaml: ${errorText(error)}`,
    );
  }
  const schemaPath = path.join(schemaDir, 'schemas', 'knowledge.schema.json');
  if (!fs.existsSync(schemaPath)) {
    throw new KnowledgeError(
      KNOWLEDGE_ERRORS.CONFIG_INVALID,
      'مخطَّط سياسة المعرفة غائب؛ ولا تُقبل سياسةٌ غيرُ متحقَّقٍ منها.',
    );
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, 'utf8')),
  );
  if (!validate(raw)) {
    const problems = (validate.errors ?? [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message ?? ''}`.trim())
      .join(' | ');
    throw new KnowledgeError(
      KNOWLEDGE_ERRORS.CONFIG_INVALID,
      `سياسة المعرفة تخالف مخطَّطها: ${problems}`,
    );
  }

  const doc = /** @type {KnowledgePolicy} */ (raw);
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const standardIds = new Set();
  for (const standard of doc.standards) {
    if (standardIds.has(standard.id)) problems.push(`معيارٌ مكرَّر: ${standard.id}`);
    standardIds.add(standard.id);
    /** @type {Set<string>} */
    const clauseIds = new Set();
    for (const clause of standard.clauses) {
      if (clauseIds.has(clause.id)) {
        problems.push(`بندٌ مكرَّر في ${standard.id}: ${clause.id}`);
      }
      clauseIds.add(clause.id);
    }
  }
  /** @type {Map<string, ExperimentKind>} */
  const kinds = new Map();
  for (const kind of doc.experimentKinds) {
    if (kinds.has(kind.id)) problems.push(`نوعُ تجربةٍ مكرَّر: ${kind.id}`);
    // نوعٌ بلا ارتباطٍ وبلا سبب هو الصيغةُ التي يدوم بها الغياب: مَن قرأ السياسةَ
    // لاحقاً لا يعرف هل الارتباطُ نُسي أم أُجِّل بقرار.
    if (kind.boundTo === null && (kind.reason ?? '').trim() === '') {
      problems.push(`النوع «${kind.id}» بلا ارتباطٍ في الشيفرة وبلا سببٍ مكتوب`);
    }
    if (kind.boundTo !== null && kind.reason !== null) {
      problems.push(`النوع «${kind.id}» مربوطٌ ومعتذَرٌ عنه معاً؛ أحدُهما زائد`);
    }
    kinds.set(
      kind.id,
      Object.freeze({ ...kind, subjectKeys: Object.freeze([...kind.subjectKeys]) }),
    );
  }
  if (problems.length > 0) {
    throw new KnowledgeError(
      KNOWLEDGE_ERRORS.CONFIG_INVALID,
      `سياسة المعرفة غيرُ متماسكة: ${problems.join(' | ')}`,
    );
  }

  return Object.freeze({
    version: doc.version,
    owner: doc.owner,
    standards: Object.freeze(
      doc.standards.map((standard) =>
        Object.freeze({
          ...standard,
          enforcedBy: Object.freeze([...standard.enforcedBy]),
          clauses: Object.freeze(standard.clauses.map((clause) => Object.freeze({ ...clause }))),
        }),
      ),
    ),
    experimentKinds: Object.freeze([...kinds.values()]),
    reproducibility: Object.freeze({
      requiredFields: Object.freeze([...doc.reproducibility.requiredFields]),
      minHexLength: doc.reproducibility.minHexLength,
    }),
    integrity: Object.freeze({
      ...doc.integrity,
      forbiddenFields: Object.freeze([...doc.integrity.forbiddenFields]),
    }),
    roles: Object.freeze({
      registrars: Object.freeze([...doc.roles.registrars]),
      reviewers: Object.freeze([...doc.roles.reviewers]),
    }),
    ledgerHolders: Object.freeze([...doc.ledgerHolders]),
    kindFor: (id) => kinds.get(id) ?? null,
  });
}

/**
 * تجزئةُ القيد: تُحسب على الحقول التي **يُحتجّ بها** — الموضعُ والنوعُ والموضوعُ
 * والفرضيةُ والمقاييسُ وحقولُ إعادة الإنتاج والمُسجِّلُ ووقتُه — فتعديلُ أيٍّ منها
 * لاحقاً يُكشف. ونتيجةُ التجربة **ليست فيها بالقصد**: القيدُ سندٌ سابقٌ للنتيجة،
 * وإدخالُ النتيجة في تجزئته كان سيمنع كتابتَها بعده.
 * @param {{ seq: number, id: string, kind: string, hypothesis: string, metrics: readonly string[], subject: Record<string, string>, reproducibility: Record<string, string>, registeredBy: string, registeredAt: string, prevHash: string }} fields
 * @returns {string}
 */
export function experimentHash(fields) {
  const canonical = JSON.stringify({
    seq: fields.seq,
    id: fields.id,
    kind: fields.kind,
    hypothesis: fields.hypothesis,
    metrics: [...fields.metrics],
    subject: Object.fromEntries(Object.entries(fields.subject).sort()),
    reproducibility: Object.fromEntries(Object.entries(fields.reproducibility).sort()),
    registeredBy: fields.registeredBy,
    registeredAt: fields.registeredAt,
    prevHash: fields.prevHash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** @param {unknown} value @returns {boolean} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export class ExperimentLedger {
  /**
   * @param {{ policy?: KnowledgePolicy, log?: { append: (type: string, actor: string, payload: object) => unknown }, file?: string | null, now?: () => Date }} [deps]
   */
  constructor({ policy, log, file = null, now } = {}) {
    if (!log) {
      // سجلٌّ بلا أثرٍ مدقَّق يجعل التسجيلَ نفسَه غيرَ قابلٍ للمراجعة — وهو نفسُ
      // شرطِ سجل التقييم الذي يحرسه هذا السجل.
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.INPUT_INVALID,
        'سجل التجارب يحتاج سجل أحداث؛ قيدٌ بلا أثرٍ مدقَّق ممنوع.',
      );
    }
    this.policy = policy ?? loadKnowledgePolicy();
    this.log = log;
    this.file = file === null ? null : path.resolve(file);
    this.now = now ?? (() => new Date());
    /** @type {ExperimentRecord[]} */
    this.records = [];
    this.#load();
  }

  /** يحمّل قيوداً سابقة إن كان المسار معلَناً؛ فسادُ الملف يوقف القراءة ولا يُنسى. */
  #load() {
    if (this.file === null || !fs.existsSync(this.file)) return;
    /** @type {unknown} */
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.STORAGE_INVALID,
        `سجل التجارب الدائم غير مقروء: ${errorText(error)}`,
      );
    }
    if (!Array.isArray(raw)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.STORAGE_INVALID,
        'سجل التجارب الدائم ليس قائمة قيود؛ رفضُه يمنع الاحتجاج بسندٍ تالف.',
      );
    }
    for (const entry of raw) {
      const record = /** @type {Partial<ExperimentRecord>} */ (entry);
      if (
        !isNonEmptyString(record.id) ||
        !Number.isInteger(record.seq) ||
        !isNonEmptyString(record.kind) ||
        !isNonEmptyString(record.hash) ||
        !isNonEmptyString(record.prevHash)
      ) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.STORAGE_INVALID,
          'سجل التجارب الدائم يحوي قيداً ناقصاً؛ لا يُقرأ نصفُ سندٍ سنداً.',
        );
      }
      this.records.push(/** @type {ExperimentRecord} */ (record));
    }
    // السلسلةُ تُفحص عند التحميل لا عند الاحتجاج: من عبث بالملف بين تشغيلين
    // يُكشف قبل أن يُبنى على قيوده قرار.
    const fault = this.verify();
    if (fault !== null) {
      throw new KnowledgeError(KNOWLEDGE_ERRORS.CHAIN_BROKEN, fault);
    }
  }

  /** يكتب ذرّياً: انقطاعُ الكتابة لا يُحوّل سنداً قائماً إلى ملفٍّ نصفِ مكتوب. */
  #persist() {
    if (this.file === null) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.partial`;
    fs.writeFileSync(temporary, JSON.stringify(this.records, null, 2));
    fs.renameSync(temporary, this.file);
  }

  /** @returns {string} */
  get headHash() {
    const last = this.records[this.records.length - 1];
    return last === undefined ? EXPERIMENT_GENESIS : last.hash;
  }

  /**
   * يسجّل تجربةً **قبل أن تُجرى**. كلُّ رفضٍ هنا يقع قبل أيّ كتابة، فلا يبقى في
   * السجل قيدٌ ناقصٌ يُحتجّ به.
   * @param {{ kind: string, title: string, hypothesis: string, metrics: readonly string[], subject: Record<string, string>, reproducibility: { seed: string, datasetHash: string, codeRevision: string, environment: string }, registeredBy: string, role: string }} input
   * @returns {ExperimentRecord}
   */
  register({ kind, title, hypothesis, metrics, subject, reproducibility, registeredBy, role }) {
    if (!isNonEmptyString(kind) || !isNonEmptyString(title) || !isNonEmptyString(registeredBy)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.INPUT_INVALID,
        'قيدُ التجربة يحتاج نوعاً وعنواناً ومُسجِّلاً.',
      );
    }
    if (!this.policy.roles.registrars.includes(role)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.REGISTER_REFUSED,
        `الدور «${role}» ليس من المُسجِّلين المعلَنين؛ فمن لا يملك التسجيل لا يُنشئ سنداً لنتيجة.`,
      );
    }
    const declared = this.policy.kindFor(kind);
    if (declared === null) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.KIND_UNKNOWN,
        `نوعُ التجربة «${kind}» غير معلَنٍ في سياسة المعرفة.`,
      );
    }
    if (
      this.policy.integrity.requireHypothesis &&
      (!isNonEmptyString(hypothesis) ||
        hypothesis.trim().length < this.policy.integrity.minHypothesisLength)
    ) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.HYPOTHESIS_MISSING,
        `التجربة بلا فرضيةٍ مُعلَنة (أو أقصرُ من ${this.policy.integrity.minHypothesisLength} محرفاً)؛ وتجربةٌ بلا فرضيةٍ لا يُقاس عليها حكم.`,
      );
    }
    if (!Array.isArray(metrics) || metrics.length === 0 || !metrics.every(isNonEmptyString)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.INPUT_INVALID,
        'التجربة تحتاج مقياساً واحداً على الأقل معلَناً قبل النتيجة.',
      );
    }
    const subjectRecord = subject ?? {};
    for (const key of declared.subjectKeys) {
      if (!isNonEmptyString(subjectRecord[key])) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.INPUT_INVALID,
          `موضوعُ تجربةٍ من نوع «${kind}» يحتاج الحقل «${key}»؛ فسندٌ بموضوعٍ مبهم لا يربط شيئاً بشيء.`,
        );
      }
    }
    // المادّةُ الخامّ لا تدخل سجلاً يقرؤه المراجعون: سجلٌّ يحمل المادّة يجعل
    // المعرفةَ قناةَ تسريبٍ من حيث لا تُحرَس.
    for (const field of this.policy.integrity.forbiddenFields) {
      if (
        Object.hasOwn(subjectRecord, field) ||
        Object.hasOwn(/** @type {object} */ (reproducibility ?? {}), field)
      ) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.FORBIDDEN_FIELD,
          `الحقل «${field}» محرَّمٌ في قيد التجربة؛ سجلٌّ يحمل المادّة يجعل المعرفةَ قناةَ تسريب.`,
        );
      }
    }
    const repro = /** @type {Record<string, string>} */ ({ ...(reproducibility ?? {}) });
    const missing = this.policy.reproducibility.requiredFields.filter(
      (field) => !isNonEmptyString(repro[field]),
    );
    if (missing.length > 0) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.REPRODUCIBILITY_INCOMPLETE,
        `حقولُ إعادة الإنتاج ناقصة: ${missing.join('، ')} — ونتيجةٌ لا تُعاد ليست نتيجة.`,
      );
    }
    // `datasetHash` و`codeRevision` قيمتان تُقاس صيغتُهما: «أحدث البيانات» وصفٌ
    // حرٌّ لا يُعاد به إنتاجُ شيء. والصيغةُ تُقاس ولا يُقاس الصدق (حدٌّ معلَن).
    const minHex = this.policy.reproducibility.minHexLength;
    const hexPattern = new RegExp(`^[0-9a-f]{${minHex},}$`, 'u');
    for (const field of ['datasetHash', 'codeRevision']) {
      const value = repro[field];
      if (value !== undefined && !hexPattern.test(value)) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.INPUT_INVALID,
          `الحقل «${field}» يجب أن يكون تجزئةً ست عشرية بطول ${minHex} خانةً على الأقل، لا وصفاً حرّاً.`,
        );
      }
    }

    const seq = this.records.length + 1;
    const registeredAt = this.now().toISOString();
    const id = `experiment:${createHash('sha256')
      .update(`${kind}\u0000${seq}\u0000${registeredAt}\u0000${registeredBy}`)
      .digest('hex')
      .slice(0, 40)}`;
    const prevHash = this.headHash;
    const frozenMetrics = Object.freeze([...metrics]);
    const hash = experimentHash({
      seq,
      id,
      kind,
      hypothesis,
      metrics: frozenMetrics,
      subject: subjectRecord,
      reproducibility: repro,
      registeredBy,
      registeredAt,
      prevHash,
    });
    const record = /** @type {ExperimentRecord} */ (
      Object.freeze({
        id,
        seq,
        kind,
        title,
        hypothesis,
        metrics: frozenMetrics,
        subject: Object.freeze({ ...subjectRecord }),
        reproducibility: Object.freeze(
          /** @type {{ seed: string, datasetHash: string, codeRevision: string, environment: string }} */ (
            repro
          ),
        ),
        registeredBy,
        registeredByRole: role,
        registeredAt,
        outcome: null,
        results: null,
        concludedBy: null,
        concludedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        prevHash,
        hash,
      })
    );
    this.records.push(record);
    this.#persist();
    this.log.append('knowledge.experiment.registered', registeredBy, {
      id,
      seq,
      kind,
      metrics: frozenMetrics,
      subject: record.subject,
    });
    return record;
  }

  /** @param {string} id @returns {ExperimentRecord | null} */
  findById(id) {
    return this.records.find((record) => record.id === id) ?? null;
  }

  /**
   * البوابةُ التي يمرّ بها كلُّ مَن يريد الاحتجاجَ بتجربة: تُرفض التجربةُ
   * الغائبة، والنوعُ المخالف، والموضوعُ المخالف — **قبل** أي كتابةٍ في السجل
   * المُحتَجّ به. وهذا هو معيارُ قبول `M7.08` بنصّه.
   * @param {{ experimentId: string, kind: string, subject: Record<string, string> }} input
   * @returns {ExperimentRecord}
   */
  assertRegistered({ experimentId, kind, subject }) {
    if (!isNonEmptyString(experimentId)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
        'لا معرّفَ تجربةٍ في الطلب؛ ونتيجةٌ بلا سندٍ مسجَّلٍ مرفوضة.',
      );
    }
    const record = this.findById(experimentId);
    if (record === null) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
        `التجربة «${experimentId}» غير مسجَّلة في سجل التجارب؛ فلا سندَ لهذه النتيجة.`,
      );
    }
    if (record.kind !== kind) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.SUBJECT_MISMATCH,
        `التجربة «${experimentId}» من نوع «${record.kind}» لا «${kind}»؛ فسندٌ من نوعٍ آخر ليس سنداً.`,
      );
    }
    for (const [key, value] of Object.entries(subject ?? {})) {
      if (record.subject[key] !== value) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.SUBJECT_MISMATCH,
          `موضوعُ التجربة يخالف الطلب في «${key}»: القيدُ يحمل «${record.subject[key] ?? '—'}» والطلبُ «${value}».`,
        );
      }
    }
    return record;
  }

  /**
   * يُثبّت نتيجةَ التجربة. المقاييسُ **الوحيدةُ المقبولة** هي ما سُجِّل قبل
   * النتيجة: مقياسٌ يظهر الآن أوّلَ مرّة هو الانتقاءُ اللاحق بعينه.
   * @param {{ experimentId: string, outcome: string, results: Record<string, number>, concludedBy: string }} input
   * @returns {ExperimentRecord}
   */
  conclude({ experimentId, outcome, results, concludedBy }) {
    const index = this.records.findIndex((record) => record.id === experimentId);
    const existing = this.records[index];
    if (existing === undefined) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
        `التجربة «${experimentId}» غير مسجَّلة؛ لا تُثبَّت نتيجةٌ لما لا قيدَ له.`,
      );
    }
    if (existing.outcome !== null) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.ALREADY_CONCLUDED,
        `التجربة «${experimentId}» مُنتهيةٌ بنتيجة «${existing.outcome}»؛ من أراد نتيجةً أخرى يسجّل تجربةً أخرى.`,
      );
    }
    if (!isNonEmptyString(outcome) || !isNonEmptyString(concludedBy)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.INPUT_INVALID,
        'تثبيتُ النتيجة يحتاج حُكماً ومُثبِّتاً.',
      );
    }
    const values = /** @type {Record<string, number>} */ (results ?? {});
    if (this.policy.integrity.requirePreregisteredMetrics) {
      for (const key of Object.keys(values)) {
        if (!existing.metrics.includes(key)) {
          throw new KnowledgeError(
            KNOWLEDGE_ERRORS.METRIC_UNDECLARED,
            `المقياس «${key}» لم يُسجَّل قبل النتيجة؛ واشتقاقُ معيارِ الحكم بعد رؤية الأرقام هو الانتقاءُ اللاحق نفسه.`,
          );
        }
      }
    }
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) {
        throw new KnowledgeError(
          KNOWLEDGE_ERRORS.INPUT_INVALID,
          `قيمةُ المقياس «${key}» ليست عدداً منتهياً.`,
        );
      }
    }
    // النتيجةُ تُكتب في القيد ولا تدخل تجزئتَه: التجزئةُ تحرس **السند** الذي
    // سبق النتيجة، ولو دخلت النتيجةُ فيها لَما أمكن كتابتُها بعده أصلاً.
    const updated = /** @type {ExperimentRecord} */ (
      Object.freeze({
        ...existing,
        outcome,
        results: Object.freeze({ ...values }),
        concludedBy,
        concludedAt: this.now().toISOString(),
      })
    );
    this.records[index] = updated;
    this.#persist();
    this.log.append('knowledge.experiment.concluded', concludedBy, {
      id: existing.id,
      kind: existing.kind,
      outcome,
      metrics: Object.keys(values),
    });
    return updated;
  }

  /**
   * مراجعةٌ مستقلّة: المُجري ليس المراجع، ودورُ المراجع معلَن.
   * @param {{ experimentId: string, reviewedBy: string, role: string }} input
   * @returns {ExperimentRecord}
   */
  review({ experimentId, reviewedBy, role }) {
    const index = this.records.findIndex((record) => record.id === experimentId);
    const existing = this.records[index];
    if (existing === undefined) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
        `التجربة «${experimentId}» غير مسجَّلة؛ لا تُراجَع تجربةٌ لا قيدَ لها.`,
      );
    }
    if (!this.policy.roles.reviewers.includes(role)) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.REVIEW_REFUSED,
        `الدور «${role}» ليس من المراجعين المعلَنين.`,
      );
    }
    if (
      this.policy.integrity.forbidSelfReview &&
      (reviewedBy === existing.registeredBy || reviewedBy === existing.concludedBy)
    ) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.SELF_REVIEW_REFUSED,
        'مراجعةُ المرء تجربتَه نفسَها ليست مراجعة.',
      );
    }
    if (existing.outcome === null) {
      throw new KnowledgeError(
        KNOWLEDGE_ERRORS.INPUT_INVALID,
        'لا تُراجَع تجربةٌ لم تُثبَّت نتيجتُها بعد.',
      );
    }
    const updated = /** @type {ExperimentRecord} */ (
      Object.freeze({ ...existing, reviewedBy, reviewedAt: this.now().toISOString() })
    );
    this.records[index] = updated;
    this.#persist();
    this.log.append('knowledge.experiment.reviewed', reviewedBy, {
      id: existing.id,
      kind: existing.kind,
      outcome: existing.outcome,
    });
    return updated;
  }

  /**
   * يُعيد حسابَ السلسلة كاملةً: يعيد نصَّ الخلل أو `null` إن كانت متّصلة.
   * @returns {string | null}
   */
  verify() {
    let expectedPrev = EXPERIMENT_GENESIS;
    for (const [index, record] of this.records.entries()) {
      if (record.seq !== index + 1) {
        return `التسلسل منقطع عند الموضع ${index + 1}: القيد يحمل ${record.seq}.`;
      }
      if (record.prevHash !== expectedPrev) {
        return `الوصلة مكسورة عند القيد ${record.seq}: يحمل سلفاً «${record.prevHash}» والمتوقَّع «${expectedPrev}».`;
      }
      const recomputed = experimentHash({
        seq: record.seq,
        id: record.id,
        kind: record.kind,
        hypothesis: record.hypothesis,
        metrics: record.metrics,
        subject: record.subject,
        reproducibility: /** @type {Record<string, string>} */ ({ ...record.reproducibility }),
        registeredBy: record.registeredBy,
        registeredAt: record.registeredAt,
        prevHash: record.prevHash,
      });
      if (recomputed !== record.hash) {
        return `تجزئةُ القيد ${record.seq} لا تطابق محتواه؛ عُبِث بالسند بعد كتابته.`;
      }
      expectedPrev = record.hash;
    }
    return null;
  }

  /** يفشل مغلقاً إن كانت السلسلة مكسورة. @returns {number} */
  assertIntact() {
    const fault = this.verify();
    if (fault !== null) throw new KnowledgeError(KNOWLEDGE_ERRORS.CHAIN_BROKEN, fault);
    return this.records.length;
  }
}

/** @param {ConstructorParameters<typeof ExperimentLedger>[0]} deps @returns {ExperimentLedger} */
export function createExperimentLedger(deps) {
  return new ExperimentLedger(deps);
}
