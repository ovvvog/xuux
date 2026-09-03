// اختبارُ قبولِ `M10.09` بحرفِ معيارِه: «تجاربُ فوضى تحقن عطباً حقيقيّاً وتقيس
// صمودَ فرضيّةٍ مكتوبةٍ، ويُقيَّد كلُّ انحرافٍ ويُربَط بإصلاحٍ موثَّقٍ لسببِه».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المنفِّذُ يُنادى
// **عمليّةً ابنةً حقيقيّةً** (‏`node scripts/chaos-drill.mjs`)، ويُقرأ **رمزُ
// خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ **دفترُ الفوضى من القرصِ**
// لإثباتِ أنّ التجاربَ الخمسَ جرت وأنّ عطبَ كلٍّ منها **حُقِن فعلاً** وكُتب
// **بتاريخِه** — فرمزُ خروجٍ وحدَه يُثبت أنّ التشغيلَ لم يُرفَض ولا يُثبت أنّ
// عمليّةً قُتِلت أو أنّ قرصاً امتلأ.
//
// **وبأمرٍ واحدٍ** حرفاً: نداءٌ واحدٌ يُجري التجاربَ الخمسَ كلَّها بلا تدخّلٍ
// بين تجربةٍ وتجربةٍ، ولا مُدخلَ على المدخلِ القياسيّ.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadChaosContract } from '../../src/chaos/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRILL_SCRIPT = path.join(ROOT, 'scripts/chaos-drill.mjs');
const GUARD_SCRIPT = path.join(ROOT, 'scripts/guard-chaos.mjs');

const contract = loadChaosContract();

/** @returns {string} */
function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-drill-'));
}

/**
 * نداءُ منفِّذِ الفوضى عمليّةً ابنةً حقيقيّةً وقراءةُ رمزِ خروجِه ومخرَجِه.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, report: Record<string, unknown>, stderr: string }}
 */
function runDrill(args) {
  const outcome = spawnSync(process.execPath, [DRILL_SCRIPT, '--json', ...args], {
    encoding: 'utf8',
    shell: false,
  });
  /** @type {Record<string, unknown>} */
  let report;
  try {
    report = JSON.parse(String(outcome.stdout ?? ''));
  } catch {
    report = {};
  }
  return { status: outcome.status, report, stderr: String(outcome.stderr ?? '') };
}

/**
 * @param {string} root
 * @returns {Array<Record<string, unknown>>}
 */
function readChaosLedgerFile(root) {
  const file = path.resolve(root, contract.ledger.path);
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

test('التجاربُ الخمسُ تجري بأمرٍ واحدٍ ويُحقَن عطبُ كلٍّ منها فعلاً', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root]);
  assert.equal(outcome.status, 0, `الحكمُ ليس صموداً: ${JSON.stringify(outcome.report)}`);
  assert.equal(outcome.report.verdict, 'chaos:resilient');

  const results = /** @type {Array<Record<string, unknown>>} */ (outcome.report.results);
  assert.equal(results.length, 5);
  for (const id of [
    'chaos:node-drop',
    'chaos:network-delay',
    'chaos:disk-full',
    'chaos:message-poison',
    'chaos:clock-skew',
  ]) {
    const result = results.find((entry) => entry.experiment === id);
    assert.ok(result !== undefined, `التجربة «${id}» لم تُنفَّذ في هذا التشغيل.`);
    assert.equal(result.injected, true, `عطبُ «${id}» لم يُحقَن فعلاً.`);
    assert.equal(result.upheld, true, `فرضيّةُ «${id}» أُخلِفت: ${String(result.evidence)}`);
    assert.ok(String(result.evidence).length > 20, `دليلُ «${id}» أقصرُ من أن يُقرأ.`);
  }

  // ودفترُ الفوضى يُقرأ من القرصِ: واقعةُ حقنٍ لكلِّ تجربةٍ بمقدارِها، وخاتمةُ
  // تشغيلٍ بحكمِها — وكلُّها بتاريخٍ مقروءٍ لا برقمٍ وحدَه.
  const ledger = readChaosLedgerFile(root);
  const injected = ledger.filter((entry) => entry.type === 'chaos.fault.injected');
  assert.equal(injected.length, 5, 'وقائعُ الحقنِ في الدفترِ ليست خمساً.');
  for (const experiment of contract.experiments) {
    const event = injected.find((entry) => entry.experiment === experiment.id);
    assert.ok(event !== undefined, `لا واقعةَ حقنٍ للتجربة «${experiment.id}» في الدفتر.`);
    assert.equal(event.magnitude, experiment.fault.magnitude);
    assert.equal(event.unit, experiment.fault.unit);
    assert.equal(typeof event.isoDate, 'string');
    assert.match(String(event.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
  }
  const upheld = ledger.filter((entry) => entry.type === 'chaos.hypothesis.upheld');
  assert.equal(upheld.length, 5, 'وقائعُ صمودِ الفرضيّاتِ في الدفترِ ليست خمساً.');
  const completed = ledger.find((entry) => entry.type === 'chaos.drill.completed');
  assert.ok(completed !== undefined, 'لا خاتمةَ تشغيلٍ في الدفتر.');
  assert.equal(completed.verdict, 'chaos:resilient');
  assert.equal(completed.experiments, 5);
  assert.match(String(completed.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
  fs.rmSync(root, { recursive: true, force: true });
});

test('كلُّ انحرافٍ مُقيَّدٍ مربوطٌ بمُدخلةِ عملٍ وبملفِّ إصلاحٍ يحمل علامتَه نصّاً', () => {
  const workLog = fs.readFileSync(path.join(ROOT, 'docs/roadmap/05-work-log.md'), 'utf8');
  assert.ok(contract.deviations.length >= 2, 'دفترُ الانحرافاتِ فارغٌ أو ناقص.');
  for (const deviation of contract.deviations) {
    const fix = fs.readFileSync(path.join(ROOT, deviation.fixedIn), 'utf8');
    assert.ok(
      fix.includes(deviation.marker),
      `علامةُ «${deviation.code}» ليست في ${deviation.fixedIn}.`,
    );
    assert.ok(fix.includes(deviation.code), `رمزُ «${deviation.code}» ليس نصّاً في ملفِّ إصلاحِه.`);
    assert.ok(
      workLog.includes(deviation.closedBy),
      `مُدخلةُ العملِ «${deviation.closedBy}» غيرُ موجودةٍ فالانحرافُ مفتوح.`,
    );
    const experiment = contract.experiments.find((entry) => entry.id === deviation.experiment);
    assert.ok(experiment !== undefined, `انحرافٌ لتجربةٍ غيرِ معلَنة: ${deviation.experiment}`);
    assert.equal(experiment.deviationCode, deviation.code);
  }
});

test('وسيطٌ غيرُ معروفٍ يُرَدُّ بحكمٍ لا يُتجاهَل، ولا عَلَمَ تخطٍّ في المنفِّذ', () => {
  const outcome = runDrill(['--skip-node-drop']);
  assert.notEqual(outcome.status, 0);
  assert.equal(outcome.report.verdict, 'chaos:unmeasured');
  assert.match(String(outcome.report.reason), /CHAOS_CONFIG_INVALID/u);
  const source = fs.readFileSync(DRILL_SCRIPT, 'utf8');
  for (const forbidden of ['--force-pass', '--no-verify', 'readlineSync']) {
    assert.ok(!source.includes(forbidden), `المنفِّذُ يحمل «${forbidden}».`);
  }
});

test('حاجزُ الفوضى يخرج صفراً على الحالةِ القائمة', () => {
  const outcome = spawnSync(process.execPath, [GUARD_SCRIPT], { encoding: 'utf8', shell: false });
  assert.equal(outcome.status, 0, String(outcome.stderr));
  assert.match(String(outcome.stdout), /✅ حاجز عقد اختبارات الفوضى/u);
});
