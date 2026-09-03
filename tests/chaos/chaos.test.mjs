// اختباراتُ وحدةِ الفوضى — الخطوة `M10.09`.
//
// تقيس ما **لا** يقيسه اختبارُ القبولِ: نقاءَ الحكمِ نصّاً، ورفضَ النتيجةِ
// الناقصةِ، ورفضَ الانحرافِ المفتوحِ، وتقديمَ «غيرِ المقيسِ» على «المنحرفِ»،
// وحصرَ نصفِ قطرِ الانفجار.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHAOS_ERRORS,
  ChaosError,
  DEVIATED_VERDICT,
  RESILIENT_VERDICT,
  UNMEASURED_VERDICT,
  assertDeviationsClosed,
  assertPlanCovered,
  assertResult,
  exitCodeFor,
  judgeRun,
  loadChaosContract,
  planExperiments,
  recordDeviations,
  requireClosure,
  requireExperiment,
} from '../../src/chaos/index.mjs';
import {
  appendChaosLedger,
  assertInsideBlastRadius,
  chaosPaths,
  readChaosLedger,
} from '../../scripts/lib/chaos-facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const contract = loadChaosContract();

/**
 * يُرجع عنصراً بموضعِه من قائمةٍ، ويرمي إن غاب — فالاختبارُ الذي يقرأ موضعاً
 * غائباً يُخفي إخفاقَه في «غيرِ معرَّفٍ» بدلاً من أن يُعلنَه.
 *
 * @template T
 * @param {readonly T[]} list القائمةُ المقروءة.
 * @param {number} index الموضعُ المطلوب.
 * @returns {T} العنصرُ الحاضرُ بعينه.
 */
function at_(list, index) {
  const item = list[index];
  if (item === undefined) {
    throw new Error(`الموضعُ ${String(index)} غائبٌ من قائمةٍ طولُها ${String(list.length)}.`);
  }
  return item;
}

/** @param {boolean} upheld @param {string} experiment @returns {Record<string, unknown>} */
function result(experiment, upheld) {
  return { experiment, injected: true, upheld, evidence: 'دليلٌ مقيسٌ للاختبار' };
}

/** @returns {Array<Record<string, unknown>>} */
function allUpheld() {
  return contract.experiments.map((entry) => result(entry.id, true));
}

test('العقدُ يُحمَّل بخمسِ تجاربَ مرتَّبةٍ وثلاثةِ أحكامٍ لا يخرج صفراً إلا الصمود', () => {
  assert.equal(contract.experiments.length, 5);
  assert.equal(contract.verdicts.length, 3);
  const ordered = planExperiments(contract);
  assert.deepEqual(
    ordered.map((entry) => entry.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(exitCodeFor(contract, RESILIENT_VERDICT), 0);
  assert.equal(exitCodeFor(contract, DEVIATED_VERDICT), 76);
  assert.equal(exitCodeFor(contract, UNMEASURED_VERDICT), 77);
  for (const verdict of contract.verdicts) {
    if (verdict.id !== RESILIENT_VERDICT) {
      assert.notEqual(verdict.exitCode, 0);
    }
  }
  assert.equal(requireExperiment(contract, 'chaos:node-drop').fault.magnitude, 9);
  assert.throws(
    () => requireExperiment(contract, 'chaos:nonexistent'),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.EXPERIMENT_UNDECLARED,
  );
  assert.throws(
    () => exitCodeFor(contract, 'chaos:invented'),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.VERDICT_UNDECLARED,
  );
});

test('نتيجةٌ بلا دليلٍ أو بلا حقلٍ منطقيٍّ تُرَدُّ ولا تُقرأ صموداً', () => {
  assert.throws(
    () => assertResult({ experiment: 'chaos:node-drop', injected: true, upheld: true }),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.RESULT_INVALID,
  );
  assert.throws(
    () => assertResult({ experiment: 'chaos:node-drop', injected: true, evidence: 'x' }),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.RESULT_INVALID,
  );
  assert.throws(
    () => assertResult('صمدت'),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.RESULT_INVALID,
  );
});

test('تجربةٌ معلَنةٌ بلا نتيجةٍ تُرَدُّ، ونتيجةٌ لتجربةٍ غيرِ معلَنةٍ تُرَدُّ', () => {
  const partial = allUpheld().slice(0, 4);
  assert.throws(
    () => assertPlanCovered(contract, partial),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.RESULT_MISSING,
  );
  assert.throws(
    () => assertPlanCovered(contract, [...allUpheld(), result('chaos:invented', true)]),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.EXPERIMENT_UNDECLARED,
  );
  assert.throws(
    () => assertPlanCovered(contract, [...allUpheld(), result('chaos:node-drop', false)]),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.RESULT_INVALID,
  );
  assert.equal(assertPlanCovered(contract, allUpheld()).length, 5);
});

test('كلُّ الفرضيّاتِ صامدةً ⇒ صمودٌ يخرج صفراً بلا انحرافٍ مفتوح', () => {
  const judgement = judgeRun({ contract, results: assertPlanCovered(contract, allUpheld()) });
  assert.equal(judgement.verdict, RESILIENT_VERDICT);
  assert.equal(judgement.experiments, 5);
  assert.equal(judgement.upheld, 5);
  assert.deepEqual(judgement.open, []);
  assert.equal(exitCodeFor(contract, judgement.verdict), 0);
});

test('فرضيّةٌ أُخلِفت ⇒ انحرافٌ برمزِ تجربتِه وحكمٌ يخرج 76 لا صفراً', () => {
  const results = allUpheld().map((entry) =>
    entry.experiment === 'chaos:node-drop' ? result('chaos:node-drop', false) : entry,
  );
  const judgement = judgeRun({ contract, results: assertPlanCovered(contract, results) });
  assert.equal(judgement.verdict, DEVIATED_VERDICT);
  assert.equal(exitCodeFor(contract, judgement.verdict), 76);
  assert.equal(judgement.deviations.length, 1);
  assert.equal(at_(judgement.deviations, 0).code, 'DEV-CHAOS-NODE-DROP');
});

test('عطبٌ لم يُحقَن ⇒ «غيرُ مقيسٍ» يُقدَّم على «المنحرفِ» ولا يُقرأ صموداً', () => {
  const results = allUpheld().map((entry) =>
    entry.experiment === 'chaos:disk-full'
      ? {
          experiment: 'chaos:disk-full',
          injected: false,
          upheld: false,
          evidence: 'الجهازُ غيرُ موجود',
          unavailable: CHAOS_ERRORS.INJECTION_UNAVAILABLE,
        }
      : entry,
  );
  const judgement = judgeRun({ contract, results: assertPlanCovered(contract, results) });
  assert.equal(judgement.verdict, UNMEASURED_VERDICT);
  assert.equal(exitCodeFor(contract, judgement.verdict), 77);
  assert.equal(judgement.experiments, 4);
  assert.match(judgement.reason, /لم يقع حقنُ العطب/u);
});

test('انحرافٌ بلا مُدخلةِ عملٍ تُغلِقه يُرَدُّ بـCHAOS_DEVIATION_UNCLOSED', () => {
  const results = assertPlanCovered(
    contract,
    allUpheld().map((entry) =>
      entry.experiment === 'chaos:network-delay' ? result('chaos:network-delay', false) : entry,
    ),
  );
  const deviations = recordDeviations(contract, results);
  assert.equal(deviations.length, 1);
  assert.equal(at_(deviations, 0).closed, false, 'DEV-CHAOS-NETWORK-DELAY لا مُدخلةَ إغلاقٍ له.');
  assert.throws(
    () => assertDeviationsClosed(deviations),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.DEVIATION_UNCLOSED,
  );
  const closed = recordDeviations(
    contract,
    assertPlanCovered(
      contract,
      allUpheld().map((entry) =>
        entry.experiment === 'chaos:disk-full' ? result('chaos:disk-full', false) : entry,
      ),
    ),
  );
  assert.equal(at_(closed, 0).closed, true);
  assert.equal(at_(closed, 0).closedBy, 'WL-062');
  assert.equal(assertDeviationsClosed(closed).length, 1);
  assert.equal(
    requireClosure(contract, 'DEV-CHAOS-DISK-FULL').fixedIn,
    'scripts/lib/region-facts.mjs',
  );
  assert.throws(
    () => requireClosure(contract, 'DEV-CHAOS-INVENTED'),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.DEVIATION_UNLINKED,
  );
});

test('نصفُ قطرِ الانفجارِ محصورٌ: مسارٌ خارجَ جذرِ التجاربِ يُرَدُّ', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-radius-'));
  assert.ok(assertInsideBlastRadius(contract, root, '.state/chaos/node-drop').startsWith(root));
  for (const escape of ['.state/regions', '../outside', '/etc']) {
    assert.throws(
      () => assertInsideBlastRadius(contract, root, escape),
      (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.BLAST_RADIUS_ESCAPE,
      `المسار «${escape}» لم يُرَدّ.`,
    );
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('الدفترُ إضافةٌ سطريّةٌ بساعةٍ مُمرَّرةٍ، وحدثٌ غيرُ معلَنٍ يُرَدّ', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-ledger-'));
  const at = 1_700_000_000_000;
  appendChaosLedger({
    contract,
    root,
    at,
    entry: { type: 'chaos.experiment.started', experiment: 'chaos:node-drop' },
  });
  appendChaosLedger({
    contract,
    root,
    at: at + 1,
    entry: { type: 'chaos.drill.refused', reason: CHAOS_ERRORS.CLOCK_INVALID },
  });
  const entries = readChaosLedger(contract, root);
  assert.equal(entries.length, 2);
  assert.equal(at_(entries, 0).at, at);
  assert.equal(at_(entries, 0).isoDate, new Date(at).toISOString());
  assert.equal(at_(entries, 1).type, 'chaos.drill.refused');
  assert.throws(
    () => appendChaosLedger({ contract, root, at, entry: { type: 'chaos.invented', detail: 'x' } }),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.LEDGER_INVALID,
  );
  assert.throws(
    () =>
      appendChaosLedger({
        contract,
        root,
        at: Number.NaN,
        entry: { type: 'chaos.drill.refused' },
      }),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.CLOCK_INVALID,
  );
  // وسطرٌ فاسدٌ في دفترِ الفوضى نفسِه يُرَدُّ لا يُتخطّى.
  fs.appendFileSync(chaosPaths(contract, root).ledger, '{"type":\n', 'utf8');
  assert.throws(
    () => readChaosLedger(contract, root),
    (error) => error instanceof ChaosError && error.code === CHAOS_ERRORS.LEDGER_INVALID,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('وحداتُ الحكمِ نقيّةٌ نصّاً: لا قرصَ ولا عمليّةَ ولا ساعةَ جهاز', () => {
  for (const relative of [
    'src/chaos/deviation.mjs',
    'src/chaos/experiment-plan.mjs',
    'src/chaos/judgement.mjs',
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    for (const forbidden of ["'node:fs'", "'node:child_process'", "'node:process'"]) {
      assert.ok(!source.includes(forbidden), `${relative} يستورد ${forbidden}.`);
    }
    for (const forbidden of ['Date.now(', 'setTimeout(', 'setInterval(']) {
      assert.ok(!source.includes(forbidden), `${relative} يستخدم ${forbidden}.`);
    }
  }
});

test('كلُّ ضمانٍ حاضرٌ نصّاً في ملفِّ إنفاذِه، وكلُّ معرَّفٍ موثَّقٌ في docs/CHAOS.md', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs/CHAOS.md'), 'utf8');
  for (const guarantee of contract.guarantees) {
    const enforcing = fs.readFileSync(path.join(ROOT, guarantee.enforcedIn), 'utf8');
    assert.ok(enforcing.includes(guarantee.id), `${guarantee.id} ليس في ${guarantee.enforcedIn}.`);
    assert.ok(doc.includes(guarantee.id), `${guarantee.id} غيرُ موثَّقٍ في docs/CHAOS.md.`);
  }
  for (const experiment of contract.experiments) {
    assert.ok(doc.includes(experiment.id));
    assert.ok(doc.includes(String(experiment.fault.magnitude)));
  }
  for (const entry of contract.refusalCodes) {
    assert.ok(doc.includes(entry.code), `${entry.code} غيرُ موثَّق.`);
  }
  for (const event of contract.events) {
    assert.ok(doc.includes(event), `${event} غيرُ موثَّق.`);
  }
});
