// اختبارُ قبولِ `M11.07` بحرفِ معيارِه: «تمرينٌ موثَّقٌ بزمنِ كلِّ مرحلةٍ، وصفرُ
// خطوةٍ يدويّةٍ غيرِ موثّقةٍ».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المنفِّذُ يُنادى **عمليّةً
// ابنةً حقيقيّةً** (‏`node scripts/emergency-drill.mjs`) بلا مَدخلٍ قياسيٍّ
// مفتوحٍ، ويُقرأ **رمزُ خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ **الدفترُ
// والتقريرُ من القرصِ** بتاريخِهما — فرمزُ خروجٍ وحدَه يُثبت أنّ التمرينَ لم
// يُرفَض، ولا يُثبت أنّ أطوارَه وقعت ولا أنه «موثَّقٌ بزمنِ كلِّ مرحلةٍ».

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { judgeDrill, loadEmergencyContract } from '../../src/emergency/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRILL_SCRIPT = path.join(ROOT, 'scripts/emergency-drill.mjs');

const contract = loadEmergencyContract();

/** @returns {string} */
function makeRoot() {
  return registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'emergency-drill-')));
}

/**
 * نداءُ المنفِّذِ عمليّةً ابنةً حقيقيّةً — والمَدخلُ القياسيُّ مُغلَقٌ، فلو انتظر
 * التمرينُ مُدخلَةَ إنسانٍ لَظهر ذلك حكماً لا تعليقاً.
 *
 * @param {string[]} args
 * @returns {{ status: number | null, report: Record<string, unknown>, stderr: string }}
 */
function runDrill(args) {
  const outcome = spawnSync(process.execPath, [DRILL_SCRIPT, ...args], {
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
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
 * @returns {Record<string, unknown>[]}
 */
function readLedger(root) {
  const file = path.resolve(root, contract.ledger.path);
  if (!fs.existsSync(file)) {
    return [];
  }
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => /** @type {Record<string, unknown>} */ (JSON.parse(line)));
}

test('أمرٌ واحدٌ يُجري الأطوارَ الخمسةَ بترتيبِها ويخرج بحكمِ الجاهزيّةِ صفراً', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root, '--json']);
  assert.equal(outcome.status, 0, `التمرينُ رُفِض: ${outcome.stderr}`);
  assert.equal(outcome.report.verdict, 'emergency:ready');

  const phases =
    /** @type {Array<{ phase: string, ms: number, maxMs: number, enforced: boolean }>} */ (
      outcome.report.phases
    );
  assert.deepEqual(
    phases.map((phase) => phase.phase),
    ['phase:halt', 'phase:quarantine', 'phase:recovery', 'phase:resume', 'phase:report'],
  );

  // «بزمنِ كلِّ مرحلةٍ» حرفاً: لكلِّ طورٍ رقمٌ مقيسٌ مُحاسَبٌ على عهدِه المكتوب.
  for (const phase of phases) {
    assert.ok(Number.isFinite(phase.ms), `الطورُ ${phase.phase} بلا زمنٍ مقيس`);
    assert.equal(phase.enforced, true, `الطورُ ${phase.phase} لم يقع إنفاذُه`);
    assert.ok(
      phase.ms <= phase.maxMs,
      `الطورُ ${phase.phase} استغرق ${String(phase.ms)}ms وعهدُه ${String(phase.maxMs)}ms`,
    );
  }
  const totalMs = Number(outcome.report.totalMs);
  assert.ok(Number.isFinite(totalMs));
  assert.ok(totalMs <= contract.objective.maxDrillMs);
});

test('التمرينُ «موثَّقٌ»: دفترٌ بتاريخٍ صالحٍ وتقريرٌ على القرصِ بزمنِ الأطوارِ الخمسة', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root, '--json']);
  assert.equal(outcome.status, 0, outcome.stderr);

  const ledger = readLedger(root);
  const types = ledger.map((entry) => String(entry.type));
  for (const required of [
    'emergency.halt.issued',
    'emergency.subject.quarantined',
    'emergency.state.recovered',
    'emergency.halt.resumed',
    'emergency.report.published',
    'emergency.drill.completed',
  ]) {
    assert.ok(types.includes(required), `الحدث «${required}» غائبٌ عن الدفتر`);
  }
  const completed = ledger.find((entry) => entry.type === 'emergency.drill.completed');
  assert.ok(completed !== undefined);
  assert.match(String(completed.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(
    /** @type {Record<string, unknown>} */ (completed.detail).verdict,
    'emergency:ready',
  );

  // التقريرُ يُقرأ من القرصِ لا من مخرَجٍ: وما لم يُكتَب لم يُقَس عمليّاً.
  const reportFile = String(outcome.report.reportFile ?? '');
  assert.ok(reportFile !== '' && fs.existsSync(reportFile), 'تقريرُ التمرينِ غائبٌ عن القرص');
  const body = /** @type {{ phases: { id: string, ms: number }[] }} */ (
    JSON.parse(fs.readFileSync(reportFile, 'utf8'))
  );
  assert.deepEqual(
    body.phases.map((phase) => phase.id).sort(),
    contract.phases.map((phase) => phase.id).sort(),
  );
  for (const phase of body.phases) {
    assert.ok(Number.isFinite(phase.ms), `التقريرُ ينقصه زمنُ الطورِ ${phase.id}`);
  }
  assert.ok(fs.existsSync(reportFile.replace(/\.json$/u, '.md')), 'التقريرُ المقروءُ للبشرِ غائب');

  // وسجلُّ آخرِ تمرينٍ مكتوبٌ بتاريخِه.
  const last = /** @type {Record<string, unknown>} */ (
    JSON.parse(fs.readFileSync(path.resolve(root, contract.ledger.lastDrillPath), 'utf8'))
  );
  assert.equal(last.verdict, 'emergency:ready');
  assert.match(String(last.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
});

test('الإنفاذُ مقيسٌ لا مُستنتَجٌ من غيابِ خطأٍ: كلُّ طورٍ يحمل دليلَ رفضِه أو قبولِه', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root, '--json']);
  assert.equal(outcome.status, 0, outcome.stderr);
  const phases = /** @type {Array<{ phase: string, evidence: string }>} */ (outcome.report.phases);
  /** @type {Record<string, string>} */
  const expected = {
    'phase:halt': 'HALT_NOT_CONFIRMED',
    'phase:quarantine': 'IDENTITY_NOT_ACTIVE',
    'phase:recovery': 'recovery:met',
    'phase:resume': 'running',
    'phase:report': 'drill-',
  };
  for (const [id, needle] of Object.entries(expected)) {
    const phase = phases.find((entry) => entry.phase === id);
    assert.ok(phase !== undefined, `الطورُ ${id} غائب`);
    assert.ok(
      phase.evidence.includes(needle),
      `دليلُ الطورِ ${id} لا يذكر «${needle}»: ${phase.evidence}`,
    );
  }
});

test('وسيطٌ غيرُ معروفٍ يُرَدُّ بحكمٍ غيرِ مقيسٍ ولا يُفسَّر باجتهاد', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root, '--pretend-ready']);
  assert.equal(outcome.status, 79);
  assert.match(outcome.stderr, /EMERGENCY_CONFIG_INVALID/u);
  const refused = readLedger(root).find((entry) => entry.type === 'emergency.drill.refused');
  assert.ok(refused !== undefined, 'الرفضُ لم يُقيَّد في الدفترِ — ورفضٌ لا يُكتب صمتٌ يُنسى');
});

test('تمرينٌ ينقصه طورٌ يُحكَم غيرَ مقيسٍ لا ناجحاً جزئيّاً', () => {
  const judgement = judgeDrill(contract, {
    phases: contract.phases
      .filter((phase) => phase.id !== 'phase:recovery')
      .map((phase) => ({ phase: phase.id, ms: 1, enforced: true, evidence: 'مُفترَض' })),
  });
  assert.equal(judgement.verdict, 'emergency:unmeasured');
  assert.equal(judgement.reasons[0]?.code, 'EMERGENCY_PHASE_SKIPPED');
});

test('طورٌ لم يقع إنفاذُه إخفاقٌ مقيسٌ برمزِه لا انعدامُ قياس', () => {
  const judgement = judgeDrill(contract, {
    phases: contract.phases.map((phase) => ({
      phase: phase.id,
      ms: 1,
      enforced: phase.id !== 'phase:quarantine',
      evidence: 'مُفترَض',
      ...(phase.id === 'phase:quarantine'
        ? { failureCode: 'EMERGENCY_QUARANTINE_NOT_ENFORCED' }
        : {}),
    })),
  });
  assert.equal(judgement.verdict, 'emergency:failed');
  assert.equal(judgement.reasons[0]?.code, 'EMERGENCY_QUARANTINE_NOT_ENFORCED');
});

test('زمنٌ جاوز عهدَه إخفاقٌ مُعلَنٌ لا تحذيرٌ يُقرأ ويُنسى', () => {
  const judgement = judgeDrill(contract, {
    phases: contract.phases.map((phase) => ({
      phase: phase.id,
      ms: phase.id === 'phase:halt' ? phase.maxMs + 1 : 1,
      enforced: true,
      evidence: 'مُفترَض',
    })),
  });
  assert.equal(judgement.verdict, 'emergency:failed');
  assert.ok(judgement.reasons.some((reason) => reason.code === 'EMERGENCY_TIME_EXCEEDED'));
});

test('تقريرٌ ينقصه زمنُ طورٍ يُحكَم غيرَ مقيسٍ ولو وقعت الأطوارُ كلُّها', () => {
  const judgement = judgeDrill(contract, {
    phases: contract.phases.map((phase) => ({
      phase: phase.id,
      ms: 1,
      enforced: true,
      evidence: 'مُفترَض',
    })),
    reportPhaseIds: contract.phases
      .filter((phase) => phase.id !== 'phase:report')
      .map((phase) => phase.id),
  });
  assert.equal(judgement.verdict, 'emergency:unmeasured');
  assert.equal(judgement.reasons[0]?.code, 'EMERGENCY_REPORT_INCOMPLETE');
});

test('ساعةٌ لا تُصدر عدداً منتهياً تُوقف الحكمَ قبل أيِّ حسابٍ بعدها', () => {
  const judgement = judgeDrill(contract, {
    phases: contract.phases.map((phase) => ({
      phase: phase.id,
      ms: phase.id === 'phase:resume' ? Number.NaN : 1,
      enforced: true,
      evidence: 'مُفترَض',
    })),
  });
  assert.equal(judgement.verdict, 'emergency:unmeasured');
  assert.equal(judgement.reasons[0]?.code, 'EMERGENCY_CLOCK_INVALID');
});
