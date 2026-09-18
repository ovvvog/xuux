// اختبارُ قبولِ الخطوة `M10.04`: **تقريرُ تكلفةٍ شهريٌّ مُولَّدٌ فعلاً**.
//
// و«مُولَّدٌ فعلاً» ثلاثةُ شروطٍ لا شرطٌ واحد، وكلٌّ يسقط وحدَه إن انكسر:
//
//   ١. **من قيودٍ على القرصِ لا من ذاكرةِ العملية**: القيودُ تُكتب في
//      `PersistentEventLog` حقيقيٍّ بملفٍّ متسلسلٍ، ثم يُقرأ **الملفُّ نفسُه**
//      سطراً سطراً (`readFileSync`) ويُمرَّر قارئاً إلى الدفتر. فلو صار الدفترُ
//      يشهد لنفسِه من ذاكرتِه سقط هذا الشقُّ.
//
//   ٢. **بأرقامٍ مُسنَدةٍ إلى الأبعادِ الثلاثةِ** — مؤسسةٌ ووكيلٌ ونموذجٌ —
//      **ومجموعُ الشهرِ لا يُضاعَف بعددِ الأبعاد**: القيدُ الواحدُ يقع في
//      الثلاثةِ كلِّها، فيُقاس أنّ جملةَ الشهرِ تساوي جملةَ الأبعادِ كلٍّ على
//      حدة، لا ثلاثةَ أضعافِها.
//
//   ٣. **بأثمانٍ من الوثيقةِ لا من الاختبار**: كلُّ رقمِ ثمنٍ يُقارَن به هنا
//      يُقرأ من `config/cost-capacity.yaml` ويُحسَب من صيغتِها المُعلَنة، فلو
//      شُدِّد سعرٌ في الوثيقةِ تبع الاختبارُ الوثيقةَ ولم يكذّبها.
//
// **وحدٌّ معلَن أول:** لا فوترةَ ولا عملةَ ولا مزوِّدَ خارجيّاً؛ الوحدةُ
// مِلّي‑وحدةٍ محاسبيةٍ داخليةٍ مُعلَنة، وما يُقاس هنا أنّ الدفترَ **يُسنِد
// ويُسعِّر ويُجمِّع ويُقرَّر منه حكمُ سعةٍ وانحرافٍ**، لا أنّ أحداً دفع شيئاً.
//
// **وحدٌّ معلَن ثانٍ:** الساعةُ **مُقادةٌ** من الاختبارِ كي يقع القيدُ في شهرٍ
// تقويميٍّ بعينِه بلا انتظارِ شهرٍ يمرّ؛ وذاك بعينُه سببُ حقنِ الساعةِ في
// الوحدة.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { CostCapacity, loadCostCapacityPolicy } from '../../src/cost-capacity/index.mjs';
import { OperationsCenter, loadOperationsPolicy } from '../../src/operations/index.mjs';
import { PersistentEventLog } from '../../src/root-of-trust/index.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const POLICY = loadCostCapacityPolicy({ dir: CONFIG_DIR });
const OPERATIONS_POLICY = loadOperationsPolicy({ dir: CONFIG_DIR });

const LEDGER_KEEPER = 'agent:cost-ledger';
const INSTITUTION = 'institution:digital-administration';
const OTHER_INSTITUTION = 'institution:statistics-authority';
const AGENT = 'agent:planner-001';
const MODEL = 'model:sovereign-base';

/** بندُ الاستدلالِ وثمنُه **من الوثيقةِ** لا من ثابتٍ في الاختبار. */
const TOKENS = POLICY.costItems.find((item) => item.id === 'cost:inference-tokens');
assert.ok(TOKENS !== undefined, 'بندُ cost:inference-tokens غائبٌ عن وثيقةِ التكلفةِ والسعة.');

/** قاعدةُ انحرافِ المؤسسةِ وخطُّ أساسِها — من الوثيقةِ كذلك. */
const INSTITUTION_RULE = POLICY.deviationRules.find(
  (rule) => rule.id === 'deviation:institution-total',
);
assert.ok(INSTITUTION_RULE !== undefined, 'قاعدةُ deviation:institution-total غائبةٌ عن الوثيقة.');

/**
 * قراءةُ قيودِ السجلِّ **من القرص** سطراً سطراً — وهي عينُ ما يُبنى عليه
 * التقرير؛ فلو كان السجلُّ ذاكريّاً لم يُقرأ منه شيءٌ هنا.
 * @param {string} logFile
 * @returns {Array<Record<string, unknown>>}
 */
function onDisk(logFile) {
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/** دفترٌ حقيقيٌّ على قرصٍ مؤقّتٍ بساعةٍ **مُقادةٍ** من الاختبار. */
function state() {
  const directory = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'xuux-cost-')));
  const logFile = path.join(directory, 'events.log');
  const log = new PersistentEventLog(logFile, { fsync: false });

  // آذارُ ٢٠٢٦ بالتوقيتِ العالميِّ المنسَّق — شهرٌ تقويميٌّ بعينِه لا «الآن».
  let clock = Date.UTC(2026, 2, 3, 9, 0, 0);
  /** @param {number} ms */
  const advance = (ms) => {
    clock += ms;
  };

  const operations = new OperationsCenter({
    policy: OPERATIONS_POLICY,
    dir: CONFIG_DIR,
    log,
    nowMs: () => clock,
  });

  const ledger = new CostCapacity({
    policy: POLICY,
    log,
    ledger: () => onDisk(logFile),
    operations,
    nowMs: () => clock,
  });

  return { directory, logFile, log, operations, ledger, advance };
}

test('معيارُ القبول: تقريرُ تكلفةٍ شهريٌّ يُولَّد من قيودِ السجلِّ على القرص، مُسنَداً إلى مؤسسةٍ ووكيلٍ ونموذج', () => {
  const { logFile, log, ledger, advance } = state();
  try {
    // ── استهلاكٌ حقيقيٌّ يُقيَّد قيداً قيداً، والثمنُ يُحسَب من الوثيقة ──
    const first = ledger.record(
      { item: TOKENS.id, quantity: 400_000, institution: INSTITUTION, agent: AGENT, model: MODEL },
      { actor: LEDGER_KEEPER },
    );
    advance(3_600_000);
    const second = ledger.record(
      { item: TOKENS.id, quantity: 300_000, institution: INSTITUTION, agent: AGENT, model: MODEL },
      { actor: LEDGER_KEEPER },
    );
    advance(3_600_000);
    ledger.record(
      {
        item: TOKENS.id,
        quantity: 120_000,
        institution: OTHER_INSTITUTION,
        agent: AGENT,
        model: MODEL,
      },
      { actor: LEDGER_KEEPER },
    );

    // ــ الثمنُ من صيغةِ الوثيقةِ لا من رقمٍ مكتوبٍ هنا ــ
    const expectedFirst = Math.round((400_000 * TOKENS.unitPriceMilli) / TOKENS.perUnits);
    assert.equal(first.costMilli, expectedFirst);
    assert.equal(first.period, '2026-03');
    assert.equal(second.period, '2026-03');

    // ── القيودُ على القرصِ فعلاً ──
    const disk = onDisk(logFile);
    const recorded = disk.filter((entry) => entry['type'] === POLICY.audit.usageRecordedEvent);
    assert.equal(recorded.length, 3, 'قيودُ الاستهلاكِ الثلاثةُ ليست كلُّها على القرص.');

    // ── التقريرُ يُولَّد من تلك القيودِ ──
    const report = ledger.report({ period: '2026-03', actor: LEDGER_KEEPER });

    assert.equal(report.measured, true);
    assert.equal(report.evidence.entries, 3);
    assert.equal(report.evidence.event, POLICY.audit.usageRecordedEvent);

    // كلُّ قسمٍ لازمٍ في الوثيقةِ حاضرٌ في التقريرِ بالاسم — لا قسمَ يُعِدُ به
    // نصٌّ ولا يُخرِجه كود.
    for (const section of POLICY.report.requiredSections) {
      assert.ok(section in report, `القسمُ اللازمُ «${section}» غائبٌ عن التقريرِ المُولَّد.`);
    }

    // ── الإسنادُ في الأبعادِ الثلاثة ──
    const institutions = new Map(report.byInstitution.map((row) => [row.subject, row.costMilli]));
    assert.equal(institutions.size, 2);
    assert.ok(institutions.has(INSTITUTION));
    assert.ok(institutions.has(OTHER_INSTITUTION));
    assert.equal(report.byAgent.length, 1);
    assert.equal(report.byAgent[0]?.subject, AGENT);
    assert.equal(report.byModel.length, 1);
    assert.equal(report.byModel[0]?.subject, MODEL);

    // ── الجملةُ لا تُضاعَف بعددِ الأبعاد ──
    const totalMilli = report.costMilli;
    const perInstitution = report.byInstitution.reduce((sum, row) => sum + row.costMilli, 0);
    const perAgent = report.byAgent.reduce((sum, row) => sum + row.costMilli, 0);
    const perModel = report.byModel.reduce((sum, row) => sum + row.costMilli, 0);
    assert.equal(perInstitution, totalMilli);
    assert.equal(perAgent, totalMilli);
    assert.equal(perModel, totalMilli);
    assert.equal(
      totalMilli,
      Math.round((400_000 * TOKENS.unitPriceMilli) / TOKENS.perUnits) +
        Math.round((300_000 * TOKENS.unitPriceMilli) / TOKENS.perUnits) +
        Math.round((120_000 * TOKENS.unitPriceMilli) / TOKENS.perUnits),
    );

    // ── حكمُ السعةِ مقروءٌ بأرقامِ الوثيقةِ ──
    const modelCapacity = report.capacity.find(
      (row) => row.limit === 'capacity:model-inference' && row.subject === MODEL,
    );
    assert.ok(modelCapacity !== undefined);
    assert.equal(modelCapacity.status, 'within');

    // ── والانحرافُ يُقاس على خطِّ الأساسِ المُعلَنِ: 700 ألفٍ للمؤسسةِ الأولى
    //    فوقَ المسموحِ، و120 ألفاً للثانيةِ دونَه ──
    const allowed = Math.round(
      INSTITUTION_RULE.baselineUnits * (1 + INSTITUTION_RULE.toleranceRatio),
    );
    const firing = report.deviations.find(
      (row) => row.rule === INSTITUTION_RULE.id && row.subject === INSTITUTION,
    );
    const quiet = report.deviations.find(
      (row) => row.rule === INSTITUTION_RULE.id && row.subject === OTHER_INSTITUTION,
    );
    assert.ok(firing !== undefined && quiet !== undefined);
    assert.equal(firing.allowedUnits, allowed);
    assert.equal(firing.units, 700_000);
    assert.equal(firing.firing, 700_000 > allowed);
    assert.equal(quiet.firing, false);

    // ── وتوليدُ التقريرِ نفسُه مُقيَّدٌ في السجلِّ على القرص ──
    const generated = onDisk(logFile).filter(
      (entry) => entry['type'] === POLICY.audit.reportGeneratedEvent,
    );
    assert.equal(generated.length, 1);
  } finally {
    log.close();
  }
});

test('شهرٌ بلا قيدٍ واحدٍ يُعلَن «غيرَ مقيسٍ» ولا يُعرَض صفرَ إنفاق', () => {
  const { log, ledger } = state();
  try {
    const report = ledger.report({ period: '2025-01', actor: LEDGER_KEEPER });
    assert.equal(report.measured, false);
    assert.equal(report.evidence.entries, 0);
    assert.equal(report.totals.length, 0);
    for (const row of report.capacity) {
      assert.equal(row.status, 'unmeasured');
      assert.equal(row.units, null);
    }
    for (const row of report.deviations) {
      assert.equal(row.firing, false);
      assert.equal(row.units, null);
    }
  } finally {
    log.close();
  }
});

test('الانحرافُ يُقيَّد حادثةً في مركزِ العملياتِ بعينِه، والهادئُ لا يُقيَّد', () => {
  const { log, ledger, operations } = state();
  try {
    ledger.record(
      {
        item: TOKENS.id,
        quantity: 1_200_000,
        institution: INSTITUTION,
        agent: AGENT,
        model: MODEL,
      },
      { actor: LEDGER_KEEPER },
    );
    ledger.record(
      {
        item: TOKENS.id,
        quantity: 100_000,
        institution: OTHER_INSTITUTION,
        agent: AGENT,
        model: MODEL,
      },
      { actor: LEDGER_KEEPER },
    );

    const before = operations.describe().openIncidents;
    const verdict = ledger.evaluate({ period: '2026-03', actor: LEDGER_KEEPER });
    const after = operations.describe().openIncidents;

    assert.ok(
      verdict.raised.length >= 1,
      'لم تُقيَّد حادثةُ انحرافٍ واحدةٌ رغم تجاوزِ خطِّ الأساس.',
    );
    assert.equal(after - before, verdict.raised.length);
    assert.ok(
      verdict.candidates.some((row) => row.subject === OTHER_INSTITUTION && row.firing === false),
      'القاعدةُ الهادئةُ ليست في المُقيَّمِ — و«لا انحرافَ» يجب أن يُقرأ لا أن يُستنتَج من الصمت.',
    );
    assert.ok(
      verdict.raised.every((id) => id.includes('2026-03')),
      'معرّفُ الحادثةِ بلا شهرِها — وحادثتان في شهرين بمعرّفٍ واحدٍ تُبتلع إحداهما.',
    );
  } finally {
    log.close();
  }
});
