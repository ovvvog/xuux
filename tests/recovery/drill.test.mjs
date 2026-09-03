// اختبارُ قبولِ `M10.08` بحرفِ معيارِه: «تجربة ربع سنوية موثَّقة تحقّق زمن
// التعافي المعلَن».
//
// **ولا يُقاس هذا بنداءِ دالّةٍ في العمليّةِ نفسِها:** المنفِّذُ يُنادى
// **عمليّةً ابنةً حقيقيّةً** (‏`node scripts/recovery-drill.mjs`)، ويُقرأ **رمزُ
// خروجِه** كما يقرؤه المسارُ الآليُّ، ثم يُقرأ **دفترُ التعافي وسجلُّ آخرِ
// تجربةٍ من القرصِ** لإثباتِ أنّ التجربةَ وقعت وكُتبت **بتاريخِها** — فرمزُ
// خروجٍ وحدَه يُثبت أنّ التجربةَ لم تُرفَض ولا يُثبت أنها وقعت ولا أنها
// «موثَّقةٌ».
//
// **وبأمرٍ واحدٍ** حرفاً: نداءٌ واحدٌ يُجري الأطوارَ الأربعةَ كلَّها بلا تدخّلٍ
// بين طورٍ وطورٍ، ولا مُدخلَ على المدخلِ القياسيّ.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadRecoveryContract } from '../../src/recovery/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRILL_SCRIPT = path.join(ROOT, 'scripts/recovery-drill.mjs');
const GUARD_SCRIPT = path.join(ROOT, 'scripts/guard-recovery.mjs');

const contract = loadRecoveryContract();

/** @returns {string} */
function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-drill-'));
}

/**
 * نداءُ منفِّذِ التجربةِ عمليّةً ابنةً حقيقيّةً وقراءةُ رمزِ خروجِه ومخرَجِه.
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

/**
 * @param {string} root
 * @returns {string[]}
 */
function listTree(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
      } else {
        found.push(relative);
      }
    }
  };
  walk(root, '');
  return found.sort();
}

test('نداءٌ واحدٌ يُجري الأطوارَ الأربعةَ ويستعيد كاملَ الحالةِ في زمنِ التعافي المعلَن', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root]);
  assert.equal(outcome.status, 0, `التجربةُ رُفِضت: ${outcome.stderr}`);
  assert.equal(outcome.report.verdict, 'recovery:met');

  // الأطوارُ الأربعةُ كلُّها وقعت بترتيبِها، بنداءٍ واحدٍ لا بأربعةِ نداءات.
  const phases = /** @type {Array<{ id: string, ms: number }>} */ (outcome.report.phases);
  assert.deepEqual(
    phases.map((phase) => phase.id),
    ['phase:capture', 'phase:wipe', 'phase:restore', 'phase:verify'],
  );

  // زمنُ التعافي مقيسٌ بالرقمِ ومُحاسَبٌ على العهدِ المعلَنِ لا على تقديرٍ لاحق.
  const totalMs = Number(outcome.report.totalMs);
  assert.ok(Number.isFinite(totalMs), 'زمنُ التعافي ليس عدداً منتهياً');
  assert.ok(
    totalMs <= contract.objective.maxRecoveryMs,
    `زمنُ التعافي ${String(totalMs)} جاوز العهدَ ${String(contract.objective.maxRecoveryMs)}`,
  );
  assert.equal(outcome.report.maxDataLossMs, contract.maxDataLossMs);

  // والاستعادةُ وقعت على القرصِ فعلاً: المُستعادُ يُطابِق المنسوخَ مسارَ مسارٍ.
  const backup = listTree(path.resolve(root, contract.source.backupRoot));
  const restored = listTree(path.resolve(root, contract.source.restoreRoot));
  assert.ok(backup.length > 0, 'النسخةُ الاحتياطيّةُ خاويةٌ فلا يُقاس بها تعافٍ');
  assert.deepEqual(restored, backup);
  assert.equal(Number(outcome.report.files), backup.length);
});

test('التجربةُ «موثَّقةٌ»: تُكتب في الدفترِ بتاريخِها وبحكمِها لا برمزِ خروجٍ وحدَه', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root]);
  assert.equal(outcome.status, 0);

  const ledger = readLedger(root);
  const types = ledger.map((entry) => String(entry.type));
  for (const required of [
    'recovery.backup.captured',
    'recovery.environment.wiped',
    'recovery.state.restored',
    'recovery.integrity.verified',
    'recovery.drill.completed',
  ]) {
    assert.ok(types.includes(required), `الحدث «${required}» غائبٌ عن الدفتر`);
  }
  const completed = ledger.find((entry) => entry.type === 'recovery.drill.completed');
  assert.ok(completed !== undefined);
  assert.equal(typeof completed.isoDate, 'string');
  assert.match(String(completed.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
  const detail = /** @type {Record<string, unknown>} */ (completed.detail);
  assert.equal(detail.verdict, 'recovery:met');

  // وسجلُّ آخرِ تجربةٍ مكتوبٌ بتاريخِه — ومنه يُحسَب موعدُ التاليةِ لا من ذاكرة.
  const last = /** @type {Record<string, unknown>} */ (
    JSON.parse(fs.readFileSync(path.resolve(root, contract.ledger.lastDrillPath), 'utf8'))
  );
  assert.equal(last.verdict, 'recovery:met');
  assert.equal(typeof last.at, 'number');
  assert.match(String(last.isoDate), /^\d{4}-\d{2}-\d{2}T/u);
  const dueness = /** @type {Record<string, unknown>} */ (outcome.report.dueness);
  assert.equal(dueness.overdue, false);
  assert.equal(dueness.lastDrillAt, last.at);
});

test('البيئةُ تُفرَّغ فعلاً: حالةٌ سابقةٌ في جذرِ الاستعادةِ لا تبقى بعد التجربة', () => {
  const root = makeRoot();
  const restoreRoot = path.resolve(root, contract.source.restoreRoot);
  fs.mkdirSync(path.join(restoreRoot, 'stale'), { recursive: true });
  fs.writeFileSync(path.join(restoreRoot, 'stale', 'ghost.json'), '{"ghost":true}\n');

  const outcome = runDrill(['--root', root]);
  assert.equal(outcome.status, 0, `التجربةُ رُفِضت: ${outcome.stderr}`);
  const restored = listTree(restoreRoot);
  assert.equal(
    restored.includes('stale/ghost.json'),
    false,
    'ملفٌّ سابقٌ بقي بعد التفريغِ — واستعادةٌ فوقَ حالةٍ باقيةٍ تُنجِح نفسَها بما لم تستعِده',
  );
  assert.ok(restored.length > 0);
});

test('نسخةٌ خاويةٌ لا تُقرأ نجاحاً: تجربةٌ بلا حالةٍ تُرَدُّ بحكمٍ غيرِ مقيسٍ', () => {
  const root = makeRoot();
  const outcome = runDrill(['--root', root, '--no-seed']);
  assert.equal(outcome.report.verdict, 'recovery:unmeasured');
  assert.equal(outcome.status, 75);
  assert.equal(outcome.report.reason, 'RECOVERY_BACKUP_EMPTY');
});

test('وسيطٌ غيرُ معروفٍ يُرَدُّ ولا يُفسَّر باجتهاد', () => {
  const outcome = runDrill(['--pretend-green']);
  assert.notEqual(outcome.status, 0);
  assert.equal(outcome.report.reason, 'RECOVERY_CONFIG_INVALID');
});

test('حاجزُ التعافي أخضرُ على المستودعِ الحقيقيِّ ويُسمّي ما قاسه', () => {
  const outcome = spawnSync(process.execPath, [GUARD_SCRIPT], { encoding: 'utf8', shell: false });
  assert.equal(
    outcome.status,
    0,
    `الحاجزُ رفض: ${String(outcome.stdout)}${String(outcome.stderr)}`,
  );
  const stdout = String(outcome.stdout);
  assert.match(stdout, /^✅ حاجز عقد تجارب التعافي الدوريّة:/u);
  assert.ok(stdout.includes(String(contract.objective.maxRecoveryMs)));
  assert.ok(stdout.includes(String(contract.cadence.everyDays)));
  assert.ok(stdout.includes(String(contract.maxDataLossMs)));
});
