// اختباراتُ وحداتِ التعافي النقيّة — الخطوة `M10.08`.
//
// وحداتُ `src/recovery/` لا تلمس قرصاً ولا ساعةً، فهذه الاختباراتُ تُمرِّر
// وقائعَها صريحةً وتُثبت أنّ الحكمَ **يُرَدُّ عند التحميلِ** لا في منتصفِ تجربةٍ
// وقد فُرِّغ جذرُ الاستعادةِ فعلاً.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import YAML from 'yaml';

import {
  assertBackupNotEmpty,
  assertCleanEnvironment,
  assertDrillNotOverdue,
  assertPhaseSequence,
  assertRestoredMatchesBackup,
  assertWithinObjective,
  evaluateDrillDueness,
  exitCodeFor,
  judgeRecovery,
  loadRecoveryContract,
  orderedPhaseIds,
  RECOVERY_ERRORS,
  RecoveryError,
} from '../../src/recovery/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONFIG_DIR = path.join(ROOT, 'config');

const contract = loadRecoveryContract();
const MS_PER_DAY = 86400000;

/**
 * نسخُ مجلَّدِ الوثائقِ إلى جذرٍ مؤقّتٍ ثم تعديلُ عقدِ التعافي فيه — فلا يُعدَّل
 * عقدُ المستودعِ الحقيقيُّ لأجلِ اختبار.
 *
 * @param {(draft: Record<string, unknown>) => void} mutate
 * @returns {string}
 */
function configDirWith(mutate) {
  const dir = registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-config-')));
  fs.mkdirSync(path.join(dir, 'schemas'), { recursive: true });
  for (const name of ['recovery.yaml', 'regions.yaml']) {
    fs.copyFileSync(path.join(CONFIG_DIR, name), path.join(dir, name));
  }
  for (const name of ['recovery.schema.json', 'regions.schema.json']) {
    fs.copyFileSync(path.join(CONFIG_DIR, 'schemas', name), path.join(dir, 'schemas', name));
  }
  const file = path.join(dir, 'recovery.yaml');
  const draft = /** @type {Record<string, unknown>} */ (YAML.parse(fs.readFileSync(file, 'utf8')));
  mutate(draft);
  fs.writeFileSync(file, YAML.stringify(draft), 'utf8');
  return dir;
}

/**
 * @param {() => unknown} body
 * @param {string} code
 * @returns {void}
 */
function refusesWith(body, code) {
  assert.throws(body, (/** @type {unknown} */ error) => {
    assert.ok(error instanceof RecoveryError, `الخطأُ ليس RecoveryError بل ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test('العقدُ يُحمَّل ونافذةُ الفقدِ مشتقّةٌ من عقدِ الأقاليمِ لا مكتوبةٌ فيه', () => {
  const regions = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'regions.yaml'), 'utf8'));
  assert.equal(contract.maxDataLossMs, regions.consistency.maxReplicationLagMs);
  const raw = /** @type {Record<string, unknown>} */ (
    YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'recovery.yaml'), 'utf8'))
  );
  const objective = /** @type {Record<string, unknown>} */ (raw.objective);
  for (const forbidden of ['maxDataLossMs', 'maxReplicationLagMs', 'rpoMs']) {
    assert.equal(Object.hasOwn(objective, forbidden), false);
  }
});

test('المخطَّطُ يرفض زمنَ تعافٍ أصغرَ من واحدٍ قبل أن يبلغَ المنطق', () => {
  const dir = configDirWith((draft) => {
    /** @type {Record<string, unknown>} */ (draft.objective).maxRecoveryMs = 0;
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.CONFIG_INVALID);
});

test('العقدُ يرفض زمنَ تعافٍ خارجَ المدى الأمينِ فلا يُحاسَب عليه', () => {
  const dir = configDirWith((draft) => {
    /** @type {Record<string, unknown>} */ (draft.objective).maxRecoveryMs = 9007199254740992;
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.OBJECTIVE_INVALID);
});

test('العقدُ يرفض سماحاً يبلغ الدوريّةَ فيُلغيها', () => {
  const dir = configDirWith((draft) => {
    /** @type {Record<string, unknown>} */ (draft.cadence).graceDays = 90;
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.CADENCE_INVALID);
});

test('العقدُ يرفض ترتيبَ أطوارٍ مثلوماً', () => {
  const dir = configDirWith((draft) => {
    const phases = /** @type {Array<Record<string, unknown>>} */ (draft.phases);
    const first = phases[0];
    if (first !== undefined) {
      first.order = 9;
    }
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.PHASE_ORDER_INVALID);
});

test('العقدُ يرفض استعادةً مرتَّبةً قبل التفريغ', () => {
  const dir = configDirWith((draft) => {
    const phases = /** @type {Array<Record<string, unknown>>} */ (draft.phases);
    const wipe = phases.find((phase) => phase.id === 'phase:wipe');
    const restore = phases.find((phase) => phase.id === 'phase:restore');
    if (wipe !== undefined && restore !== undefined) {
      const swapped = wipe.order;
      wipe.order = restore.order;
      restore.order = swapped;
    }
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.PHASE_ORDER_INVALID);
});

test('العقدُ يرفض حكماً بالإخفاقِ يخرج صفراً', () => {
  const dir = configDirWith((draft) => {
    const verdicts = /** @type {Array<Record<string, unknown>>} */ (draft.verdicts);
    const missed = verdicts.find((verdict) => verdict.id === 'recovery:missed');
    if (missed !== undefined) {
      missed.exitCode = 0;
    }
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.CONFIG_INVALID);
});

test('العقدُ يرفض جذرَ نسخٍ داخلَ جذرِ حالةٍ فيُمحى ما جاء يستعيده', () => {
  const dir = configDirWith((draft) => {
    /** @type {Record<string, unknown>} */ (draft.source).backupRoot = '.state/regions/backup';
  });
  refusesWith(() => loadRecoveryContract({ dir }), RECOVERY_ERRORS.CONFIG_INVALID);
});

test('رمزُ خروجِ حكمٍ غيرِ معلَنٍ يُرَدُّ لا يُخترَع', () => {
  assert.equal(exitCodeFor(contract, 'recovery:met'), 0);
  refusesWith(() => exitCodeFor(contract, 'recovery:imagined'), RECOVERY_ERRORS.VERDICT_UNDECLARED);
});

test('ترتيبُ الأطوارِ مقروءٌ من العقدِ لا مكتوبٌ في الكود', () => {
  assert.deepEqual(orderedPhaseIds(contract), [
    'phase:capture',
    'phase:wipe',
    'phase:restore',
    'phase:verify',
  ]);
});

test('تتابعُ الأطوارِ يُرَدُّ إن نقص طورٌ أو اختلَّ ترتيبُه', () => {
  const full = orderedPhaseIds(contract).map((id, index) => ({
    id,
    startedAt: index * 10,
    endedAt: index * 10 + 5,
  }));
  const sequence = assertPhaseSequence(contract, full);
  assert.equal(sequence.totalMs, 35);
  refusesWith(() => assertPhaseSequence(contract, full.slice(0, 3)), RECOVERY_ERRORS.PHASE_SKIPPED);
  const swapped = [full[1], full[0], full[2], full[3]].map((entry) => ({
    id: String(entry?.id),
    startedAt: Number(entry?.startedAt),
    endedAt: Number(entry?.endedAt),
  }));
  refusesWith(() => assertPhaseSequence(contract, swapped), RECOVERY_ERRORS.PHASE_SKIPPED);
});

test('ساعةٌ ترجع إلى الوراءِ تُرَدُّ ولا تُقاس بها مدّة', () => {
  refusesWith(
    () =>
      assertPhaseSequence(
        contract,
        orderedPhaseIds(contract).map((id) => ({ id, startedAt: 100, endedAt: 50 })),
      ),
    RECOVERY_ERRORS.CLOCK_INVALID,
  );
});

test('بيئةٌ غيرُ نظيفةٍ تردُّ التجربةَ ولا يُتغاضى عن ملفٍّ واحد', () => {
  assertCleanEnvironment('/tmp/x', []);
  refusesWith(
    () => assertCleanEnvironment('/tmp/x', ['leftover.json']),
    RECOVERY_ERRORS.ENVIRONMENT_NOT_CLEAN,
  );
});

test('نسخةٌ خاويةٌ تُرَدُّ فمطابقتُها لنفسِها أتمُّ مطابقةٍ وأسوأُ إخفاق', () => {
  refusesWith(() => assertBackupNotEmpty({}), RECOVERY_ERRORS.BACKUP_EMPTY);
  refusesWith(() => assertRestoredMatchesBackup({}, {}), RECOVERY_ERRORS.BACKUP_EMPTY);
});

test('المطابقةُ ملفّاً ملفّاً تُسمّي الملفَّ المُعطوبَ ولا تكتفي بالعدد', () => {
  const backup = { 'a.json': 'aa', 'b/c.json': 'bb' };
  const matched = assertRestoredMatchesBackup(backup, { ...backup });
  assert.equal(matched.files, 2);
  refusesWith(
    () => assertRestoredMatchesBackup(backup, { 'a.json': 'aa' }),
    RECOVERY_ERRORS.RESTORE_INCOMPLETE,
  );
  refusesWith(
    () => assertRestoredMatchesBackup(backup, { 'a.json': 'aa', 'b/c.json': 'zz' }),
    RECOVERY_ERRORS.INTEGRITY_MISMATCH,
  );
  refusesWith(
    () => assertRestoredMatchesBackup(backup, { 'a.json': 'aa', 'other.json': 'bb' }),
    RECOVERY_ERRORS.RESTORE_INCOMPLETE,
  );
});

test('الحكمُ بالبلوغِ لا يُطلَق إلا بقياسٍ كاملٍ ومطابقةٍ وملفّات', () => {
  const met = judgeRecovery(contract, { totalMs: 120, files: 5, verified: true, phases: 4 });
  assert.equal(met.verdict, 'recovery:met');
  assert.equal(met.exitCode, 0);
  assert.equal(met.maxDataLossMs, contract.maxDataLossMs);
});

test('تجاوزُ العهدِ حكمٌ بالإخفاقِ برمزٍ موجبٍ لا تحذيرٌ يُقرأ ويُنسى', () => {
  const missed = judgeRecovery(contract, {
    totalMs: contract.objective.maxRecoveryMs + 1,
    files: 5,
    verified: true,
    phases: 4,
  });
  assert.equal(missed.verdict, 'recovery:missed');
  assert.equal(missed.exitCode, 74);
  refusesWith(
    () => assertWithinObjective(contract, contract.objective.maxRecoveryMs + 1),
    RECOVERY_ERRORS.TIME_EXCEEDED,
  );
});

test('غيابُ القياسِ لا يُقرأ نجاحاً بل حكماً غيرَ مقيسٍ برمزٍ موجب', () => {
  for (const measurement of [
    { totalMs: undefined, files: 5, verified: true, phases: 4 },
    { totalMs: 10, files: 0, verified: true, phases: 4 },
    { totalMs: 10, files: 5, verified: false, phases: 4 },
    { totalMs: 10, files: 5, verified: true, phases: 3 },
  ]) {
    const judged = judgeRecovery(contract, measurement);
    assert.equal(judged.verdict, 'recovery:unmeasured');
    assert.equal(judged.exitCode, 75);
  }
});

test('فواتُ التجربةِ يُحسَب من سجلِّها لا من ذاكرةِ منفِّذ', () => {
  const now = 1700000000000;
  const fresh = evaluateDrillDueness(contract, { lastDrillAt: now - 10 * MS_PER_DAY, now });
  assert.equal(fresh.overdue, false);
  assert.equal(fresh.sinceDays, 10);
  const stale = evaluateDrillDueness(contract, { lastDrillAt: now - 200 * MS_PER_DAY, now });
  assert.equal(stale.overdue, true);
  refusesWith(
    () => assertDrillNotOverdue(contract, { lastDrillAt: now - 200 * MS_PER_DAY, now }),
    RECOVERY_ERRORS.DRILL_OVERDUE,
  );
});

test('غيابُ السجلِّ ليس براءةً: التجربةُ مُستحقّةٌ لا مُؤجَّلة', () => {
  const dueness = evaluateDrillDueness(contract, { lastDrillAt: undefined, now: 1700000000000 });
  assert.equal(dueness.overdue, true);
  assert.equal(dueness.lastDrillAt, undefined);
});

test('ساعةٌ لا تُصدر عدداً وسجلٌّ لا يُقرأ يُرَدّانِ برمزِهما', () => {
  refusesWith(
    () => evaluateDrillDueness(contract, { lastDrillAt: 1, now: Number.NaN }),
    RECOVERY_ERRORS.CLOCK_INVALID,
  );
  refusesWith(
    () => evaluateDrillDueness(contract, { lastDrillAt: Number.NaN, now: 1700000000000 }),
    RECOVERY_ERRORS.LEDGER_INVALID,
  );
});
