/**
 * اختبارات سجل التجارب ومعايير المعرفة — الخطوة M7.08.
 *
 * معيارُ القبول المعلَن في خارطة الطريق: **«تجربة بلا تسجيل في سجل التجارب
 * تُرفض»** — وهو أوّلُ اختبارٍ هنا، مقيساً على مسار الإنفاذ الحقيقيّ
 * (`ModelEvaluationLedger.record`) لا على السجل وحده.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import {
  EXPERIMENT_GENESIS,
  ExperimentLedger,
  KNOWLEDGE_ERRORS,
  KnowledgeError,
  loadKnowledgePolicy,
} from '../../src/knowledge/index.mjs';
import { MODEL_EVALUATION_ERRORS, ModelEvaluationLedger } from '../../src/models/evaluation.mjs';

/** سجل أحداثٍ صغير: الأثرُ المدقَّق شرطُ تركيبٍ في السجلَّين معاً. */
function fakeLog() {
  /** @type {Array<{ type: string, actor: string, payload: object }>} */
  const entries = [];
  return {
    entries,
    /** @param {string} type @param {string} actor @param {object} payload */
    append(type, actor, payload) {
      entries.push({ type, actor, payload });
      return { type, actor };
    },
  };
}

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const HEX_40 = 'c'.repeat(40);

/** @param {Partial<Record<string, unknown>>} [overrides] */
function validRegistration(overrides = {}) {
  return {
    kind: 'model-evaluation',
    title: 'تقييم النموذج قبل تنشيطه',
    hypothesis: 'أوزانُ هذه البصمة تتجاوز عتباتِ الفحوص الواجبة كلَّها.',
    metrics: ['safety', 'accuracy'],
    subject: { modelId: 'model:alpha', fingerprint: FINGERPRINT_A },
    reproducibility: {
      seed: '42',
      datasetHash: HEX_40,
      codeRevision: HEX_40,
      environment: 'node20-linux',
    },
    registeredBy: 'actor:minister',
    role: 'role:minister',
    ...overrides,
  };
}

/** @type {string[]} */
const temporaryDirectories = [];
function tempDir() {
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-')));
  temporaryDirectories.push(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('سياسة المعرفة', () => {
  it('تُحمَّل من config وتُعلن المعايير الأربعة وأدوارها', () => {
    const policy = loadKnowledgePolicy();
    assert.equal(policy.owner, 'crown');
    assert.deepEqual(policy.standards.map((standard) => standard.id).sort(), [
      'experiment-ledger',
      'model-evaluation',
      'reproducibility',
      'research-integrity',
    ]);
    assert.ok(policy.roles.registrars.includes('role:minister'));
    // الوكيلُ ليس مُسجِّلاً ولا مراجعاً بالقصد: من تُقاس أوزانُه لا يكتب سندَها.
    assert.ok(!policy.roles.registrars.includes('role:agent'));
    assert.ok(!policy.roles.reviewers.includes('role:agent'));
  });

  it('كلُّ بندٍ يحمل رمزَ رفضٍ معرَّفاً فعلاً', () => {
    const policy = loadKnowledgePolicy();
    const codes = new Set(/** @type {string[]} */ (Object.values(KNOWLEDGE_ERRORS)));
    for (const standard of policy.standards) {
      assert.ok(standard.clauses.length > 0, `المعيار ${standard.id} بلا بنود`);
      for (const clause of standard.clauses) {
        assert.ok(
          codes.has(clause.code) || clause.code.startsWith('MODEL_EVALUATION_'),
          `الرمز ${clause.code} غيرُ معرَّف`,
        );
      }
    }
  });

  it('ترفض سياسةً بلا ملف', () => {
    assert.throws(
      () => loadKnowledgePolicy({ dir: tempDir() }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.CONFIG_INVALID,
    );
  });

  it('ترفض سياسةً تخالف المخطَّط الصارم', () => {
    const directory = tempDir();
    fs.writeFileSync(path.join(directory, 'knowledge.yaml'), 'version: 1\nowner: crown\n');
    assert.throws(
      () => loadKnowledgePolicy({ dir: directory }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.CONFIG_INVALID,
    );
  });
});

describe('سجل التجارب', () => {
  it('يرفض التركيب بلا سجل أحداث', () => {
    assert.throws(
      () => new ExperimentLedger({}),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.INPUT_INVALID,
    );
  });

  it('يسجّل تجربةً ويكتب حدثاً ويبدأ السلسلة من الجينيسيس', () => {
    const log = fakeLog();
    const ledger = new ExperimentLedger({ log });
    assert.equal(ledger.headHash, EXPERIMENT_GENESIS);
    const record = ledger.register(validRegistration());
    assert.equal(record.seq, 1);
    assert.equal(record.prevHash, EXPERIMENT_GENESIS);
    assert.equal(record.outcome, null);
    assert.equal(log.entries[0]?.type, 'knowledge.experiment.registered');
    assert.equal(ledger.verify(), null);
  });

  it('يرفض دوراً ليس من المُسجِّلين', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () => ledger.register(validRegistration({ role: 'role:agent' })),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.REGISTER_REFUSED,
    );
  });

  it('يرفض نوعاً غير معلَن', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () => ledger.register(validRegistration({ kind: 'vibes' })),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.KIND_UNKNOWN,
    );
  });

  it('يرفض تجربةً بلا فرضية', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () => ledger.register(validRegistration({ hypothesis: 'جيّد' })),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.HYPOTHESIS_MISSING,
    );
  });

  it('يرفض حقولَ إعادة إنتاجٍ ناقصة', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () =>
        ledger.register(
          validRegistration({
            reproducibility: { seed: '1', datasetHash: HEX_40, codeRevision: HEX_40 },
          }),
        ),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError &&
        error.code === KNOWLEDGE_ERRORS.REPRODUCIBILITY_INCOMPLETE,
    );
  });

  it('يرفض وصفاً حرّاً بدل تجزئة البيانات', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () =>
        ledger.register(
          validRegistration({
            reproducibility: {
              seed: '1',
              datasetHash: 'أحدث البيانات',
              codeRevision: HEX_40,
              environment: 'node20',
            },
          }),
        ),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.INPUT_INVALID,
    );
  });

  it('يرفض موضوعاً ناقصَ مفاتيح النوع', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () => ledger.register(validRegistration({ subject: { modelId: 'model:alpha' } })),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.INPUT_INVALID,
    );
  });

  it('يرفض مادّةً خامّاً في قيد التجربة', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    assert.throws(
      () =>
        ledger.register(
          validRegistration({
            subject: { modelId: 'model:alpha', fingerprint: FINGERPRINT_A, weights: 'AAAA' },
          }),
        ),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.FORBIDDEN_FIELD,
    );
  });

  it('يرفض مقياساً لم يُسجَّل قبل النتيجة', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    const record = ledger.register(validRegistration());
    assert.throws(
      () =>
        ledger.conclude({
          experimentId: record.id,
          outcome: 'passed',
          results: { accuracy: 0.9, wowFactor: 1 },
          concludedBy: 'actor:minister',
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.METRIC_UNDECLARED,
    );
  });

  it('يرفض إعادة تثبيت نتيجةٍ لتجربةٍ منتهية', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    const record = ledger.register(validRegistration());
    ledger.conclude({
      experimentId: record.id,
      outcome: 'passed',
      results: { accuracy: 0.9 },
      concludedBy: 'actor:minister',
    });
    assert.throws(
      () =>
        ledger.conclude({
          experimentId: record.id,
          outcome: 'passed',
          results: { accuracy: 0.99 },
          concludedBy: 'actor:minister',
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.ALREADY_CONCLUDED,
    );
  });

  it('يرفض أن يراجع المرءُ تجربتَه، ويقبل مراجعاً مستقلّاً', () => {
    const ledger = new ExperimentLedger({ log: fakeLog() });
    const record = ledger.register(validRegistration());
    ledger.conclude({
      experimentId: record.id,
      outcome: 'passed',
      results: { accuracy: 0.9 },
      concludedBy: 'actor:minister',
    });
    assert.throws(
      () =>
        ledger.review({
          experimentId: record.id,
          reviewedBy: 'actor:minister',
          role: 'role:auditor',
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.SELF_REVIEW_REFUSED,
    );
    assert.throws(
      () =>
        ledger.review({ experimentId: record.id, reviewedBy: 'actor:agent', role: 'role:agent' }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.REVIEW_REFUSED,
    );
    const reviewed = ledger.review({
      experimentId: record.id,
      reviewedBy: 'actor:auditor',
      role: 'role:auditor',
    });
    assert.equal(reviewed.reviewedBy, 'actor:auditor');
  });

  it('يكشف العبثَ بقيدٍ سابقٍ عند التحميل', () => {
    const directory = tempDir();
    const file = path.join(directory, 'experiments.json');
    const ledger = new ExperimentLedger({ log: fakeLog(), file });
    ledger.register(validRegistration());
    ledger.register(
      validRegistration({ subject: { modelId: 'model:beta', fingerprint: FINGERPRINT_B } }),
    );
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw[0].hypothesis = 'فرضيةٌ أخرى كُتبت بعد رؤية النتيجة تماماً.';
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    assert.throws(
      () => new ExperimentLedger({ log: fakeLog(), file }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.CHAIN_BROKEN,
    );
  });

  it('يعبر إعادة التشغيل بملفٍّ ذرّيّ وتبقى السلسلة متّصلة', () => {
    const file = path.join(tempDir(), 'nested', 'experiments.json');
    const first = new ExperimentLedger({ log: fakeLog(), file });
    const record = first.register(validRegistration());
    const second = new ExperimentLedger({ log: fakeLog(), file });
    assert.equal(second.assertIntact(), 1);
    assert.equal(second.findById(record.id)?.hash, record.hash);
  });
});

describe('معيار القبول: تجربة بلا تسجيل تُرفض', () => {
  it('سجلُّ التقييم لا يُبنى بلا سجل تجارب', () => {
    assert.throws(
      () => new ModelEvaluationLedger({ log: fakeLog() }),
      /** @param {unknown} error */ (error) =>
        /** @type {{ code?: string }} */ (error).code ===
        MODEL_EVALUATION_ERRORS.DEPENDENCY_MISSING,
    );
  });

  it('يرفض نتيجةً لتجربةٍ غير مسجَّلة ولا يكتب شيئاً ولا ينشر حدثاً', () => {
    const log = fakeLog();
    const experiments = new ExperimentLedger({ log: fakeLog() });
    const file = path.join(tempDir(), 'evaluations.json');
    const ledger = new ModelEvaluationLedger({ log, experiments, file });
    assert.throws(
      () =>
        ledger.record({
          modelId: 'model:alpha',
          fingerprint: FINGERPRINT_A,
          evaluatedBy: 'actor:minister',
          experimentId: 'experiment:لا-وجود-له',
          results: [],
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
    );
    // الرفضُ قبل أيّ أثر: لا ملفَّ مكتوباً، ولا حدثَ منشوراً، ولا نتيجةَ في الذاكرة.
    assert.equal(fs.existsSync(file), false);
    assert.equal(log.entries.length, 0);
    assert.equal(ledger.latestFor('model:alpha', FINGERPRINT_A), null);
  });

  it('يرفض نتيجةً بلا معرّف تجربةٍ أصلاً', () => {
    const experiments = new ExperimentLedger({ log: fakeLog() });
    const ledger = new ModelEvaluationLedger({ log: fakeLog(), experiments });
    assert.throws(
      () =>
        ledger.record({
          modelId: 'model:alpha',
          fingerprint: FINGERPRINT_A,
          evaluatedBy: 'actor:minister',
          experimentId: '',
          results: [],
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.EXPERIMENT_UNREGISTERED,
    );
  });

  it('يرفض تجربةً على بصمةٍ أخرى', () => {
    const experiments = new ExperimentLedger({ log: fakeLog() });
    const record = experiments.register(validRegistration());
    const ledger = new ModelEvaluationLedger({ log: fakeLog(), experiments });
    assert.throws(
      () =>
        ledger.record({
          modelId: 'model:alpha',
          fingerprint: FINGERPRINT_B,
          evaluatedBy: 'actor:minister',
          experimentId: record.id,
          results: [],
        }),
      /** @param {unknown} error */ (error) =>
        error instanceof KnowledgeError && error.code === KNOWLEDGE_ERRORS.SUBJECT_MISMATCH,
    );
  });

  it('يقبل نتيجةً بتجربةٍ مسجَّلةٍ مطابقة ويحفظ سندَها في القيد وفي الحدث', () => {
    const log = fakeLog();
    const experiments = new ExperimentLedger({ log: fakeLog() });
    const record = experiments.register(validRegistration());
    const ledger = new ModelEvaluationLedger({ log, experiments });
    const evaluation = ledger.record({
      modelId: 'model:alpha',
      fingerprint: FINGERPRINT_A,
      evaluatedBy: 'actor:minister',
      experimentId: record.id,
      results: [],
    });
    assert.equal(evaluation.experimentId, record.id);
    const entry = log.entries[0];
    assert.ok(entry !== undefined, 'لم يُنشر حدثُ تقييم');
    assert.equal(/** @type {{ experimentId?: string }} */ (entry.payload).experimentId, record.id);
  });

  it('يرفض نتيجةً محفوظةً في الملف بلا معرّف تجربة', () => {
    const experiments = new ExperimentLedger({ log: fakeLog() });
    const file = path.join(tempDir(), 'evaluations.json');
    fs.writeFileSync(
      file,
      JSON.stringify([
        {
          modelId: 'model:alpha',
          fingerprint: FINGERPRINT_A,
          state: 'passed',
          evaluatedBy: 'actor:minister',
          evaluatedAt: new Date().toISOString(),
          results: [],
        },
      ]),
    );
    assert.throws(
      () => new ModelEvaluationLedger({ log: fakeLog(), experiments, file }),
      /** @param {unknown} error */ (error) =>
        /** @type {{ code?: string }} */ (error).code === MODEL_EVALUATION_ERRORS.STORAGE_INVALID,
    );
  });
});
