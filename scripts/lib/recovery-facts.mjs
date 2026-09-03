/**
 * جامعُ وقائعِ التعافي وكاتبُ دفترِها — الخطوة `M10.08`.
 *
 * **هذا هو الموضعُ الوحيدُ الذي يلمس القرصَ** في مسارِ التعافي كلِّه؛ ووحداتُ
 * `src/recovery/` نقيّةٌ لا تستورد `node:fs` أصلاً فلا تستطيع أن تفعل
 * (‏`G-RECOVERY-PURE-JUDGEMENT`). وفصلُ الوقائعِ عن الحكمِ هو ما يجعل تجربةَ
 * تعافٍ كاملةً قابلةً للاختبارِ في جذرٍ مؤقّتٍ بلا سحابةٍ ولا انتظارِ ربعِ سنة.
 *
 * والضمانُ المُنفَّذُ هنا `G-RECOVERY-INJECTED-CLOCK`: كلُّ زمنٍ يُقاس أو يُكتب
 * في الدفترِ يصل **مُعامِلاً** `at` — لا `Date.now()` في متنِ منطقٍ ولا مؤقِّتٌ
 * يعمل بنفسِه — فزمنُ التعافي يُثبَّت في الاختبارِ ولا يُقرأ من ساعةِ جهازٍ
 * مشغولٍ ثم يُقال «كان بطيئاً لأسبابٍ خارجة».
 *
 * @module scripts/lib/recovery-facts
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { RECOVERY_ERRORS, RecoveryError } from '../../src/recovery/errors.mjs';
import { assertPhaseSequence } from '../../src/recovery/drill-plan.mjs';
import {
  assertBackupNotEmpty,
  assertCleanEnvironment,
  assertRestoredMatchesBackup,
} from '../../src/recovery/integrity.mjs';
import { judgeRecovery } from '../../src/recovery/judgement.mjs';
import { evaluateDrillDueness } from '../../src/recovery/schedule.mjs';

/**
 * @typedef {import('../../src/recovery/contract.mjs').RecoveryContract} RecoveryContract
 * @typedef {import('../../src/recovery/drill-plan.mjs').PhaseRecord} PhaseRecord
 */

/**
 * @param {number} at
 * @returns {void}
 */
function assertClock(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new RecoveryError(
      RECOVERY_ERRORS.CLOCK_INVALID,
      'الساعةُ المُمرَّرةُ لا تُصدر عدداً منتهياً — ولا يُقاس بها زمنُ تعافٍ ولا يُختم بها سطرُ دفتر.',
      { at },
    );
  }
}

/**
 * مواضعُ التعافي مُطلَقةً من جذرٍ مُمرَّر — ولا جذرَ مكتوبٌ هنا، فالاختبارُ
 * يُنشِئ جذرَه المؤقّتَ ويُمرِّره.
 *
 * @param {RecoveryContract} contract
 * @param {string} root
 * @returns {{ state: string, backup: string, restore: string, ledger: string, lastDrill: string }}
 */
export function recoveryPaths(contract, root) {
  return {
    state: path.resolve(root, contract.source.stateRoot),
    backup: path.resolve(root, contract.source.backupRoot),
    restore: path.resolve(root, contract.source.restoreRoot),
    ledger: path.resolve(root, contract.ledger.path),
    lastDrill: path.resolve(root, contract.ledger.lastDrillPath),
  };
}

/**
 * سردُ الملفّاتِ داخلَ جذرٍ سرداً عميقاً بمساراتٍ نسبيّةٍ مرتَّبة.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((first, second) => (first.name < second.name ? -1 : 1))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        found.push(relative);
      }
    }
  };
  walk(root, '');
  return found;
}

/**
 * بصمُ كلِّ ملفٍّ في جذرٍ على حدةٍ — لا بصمةٌ واحدةٌ للجميعِ، فالمطابقةُ ملفّاً
 * ملفّاً هي التي تُسمّي الملفَّ المُعطوب.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function digestTree(root) {
  /** @type {Record<string, string>} */
  const digests = {};
  for (const relative of listFiles(root)) {
    digests[relative] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(root, relative)))
      .digest('hex');
  }
  return digests;
}

/**
 * نسخُ شجرةِ ملفّاتٍ من جذرٍ إلى جذرٍ نسخاً عميقاً.
 *
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function copyTree(from, to) {
  let count = 0;
  for (const relative of listFiles(from)) {
    const target = path.join(to, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(from, relative), target);
    count += 1;
  }
  return count;
}

/**
 * تفريغُ جذرٍ تفريغاً تامّاً حتى يصير خالياً فعلاً ثم إثباتُ خلوِّه.
 *
 * @param {string} root
 * @returns {void}
 */
export function wipeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  assertCleanEnvironment(root, fs.readdirSync(root));
}

/**
 * قراءةُ تاريخِ آخرِ تجربةٍ من سجلِّها — ولا يُخترَع تاريخٌ عند غيابِ السجل.
 *
 * @param {RecoveryContract} contract
 * @param {string} root
 * @returns {number | undefined}
 */
export function readLastDrillAt(contract, root) {
  const file = recoveryPaths(contract, root).lastDrill;
  if (!fs.existsSync(file)) {
    return undefined;
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new RecoveryError(
      RECOVERY_ERRORS.LEDGER_INVALID,
      `سجلُّ آخرِ تجربةٍ موجودٌ ولا يُقرأ: ${error instanceof Error ? error.message : String(error)}`,
      { file },
    );
  }
  const record = /** @type {{ at?: unknown }} */ (parsed);
  if (typeof record.at !== 'number' || !Number.isSafeInteger(record.at)) {
    throw new RecoveryError(
      RECOVERY_ERRORS.LEDGER_INVALID,
      'سجلُّ آخرِ تجربةٍ ينقصه تاريخُه أو تاريخُه ليس عدداً صحيحاً — وسجلٌّ بلا تاريخٍ لا يُحسَب منه موعد.',
      { file },
    );
  }
  return record.at;
}

/**
 * حكمُ فواتِ التجربةِ مقروءاً من الدفترِ لا من وسيطٍ يُمرَّر.
 *
 * @param {RecoveryContract} contract
 * @param {{ root: string, at: number }} facts
 * @returns {import('../../src/recovery/schedule.mjs').DrillDueness}
 */
export function measureDueness(contract, facts) {
  assertClock(facts.at);
  return evaluateDrillDueness(contract, {
    lastDrillAt: readLastDrillAt(contract, facts.root),
    now: facts.at,
  });
}

/**
 * كتابةُ سطرِ حدثٍ في دفترِ التعافي — بختمٍ زمنيٍّ مُمرَّرٍ لا مقروءٍ من الجهاز.
 *
 * @param {RecoveryContract} contract
 * @param {{ root: string, at: number, type: string, detail?: Record<string, unknown> }} entry
 * @returns {void}
 */
export function appendRecoveryEvent(contract, entry) {
  assertClock(entry.at);
  if (!contract.events.includes(entry.type)) {
    throw new RecoveryError(
      RECOVERY_ERRORS.CONFIG_INVALID,
      `الحدث «${entry.type}» غيرُ مُعلَنٍ في عقدِ التعافي — ولا يُكتب في الدفترِ حدثٌ لا إعلانَ له.`,
      { type: entry.type },
    );
  }
  const file = recoveryPaths(contract, entry.root).ledger;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      at: entry.at,
      isoDate: new Date(entry.at).toISOString(),
      type: entry.type,
      detail: entry.detail ?? {},
    })}\n`,
  );
}

/**
 * كتابةُ سجلِّ آخرِ تجربةٍ بحكمِها وتاريخِها.
 *
 * @param {RecoveryContract} contract
 * @param {{ root: string, at: number, verdict: string, totalMs: number | undefined, files: number }} record
 * @returns {void}
 */
export function writeLastDrill(contract, record) {
  assertClock(record.at);
  const file = recoveryPaths(contract, record.root).lastDrill;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        at: record.at,
        isoDate: new Date(record.at).toISOString(),
        verdict: record.verdict,
        totalMs: record.totalMs,
        files: record.files,
        maxRecoveryMs: contract.objective.maxRecoveryMs,
        maxDataLossMs: contract.maxDataLossMs,
      },
      undefined,
      2,
    )}\n`,
  );
}

/**
 * تنفيذُ تجربةِ التعافي كاملةً بأمرٍ واحدٍ: نسخٌ فبصمٌ فتفريغٌ فاستعادةٌ فمطابقةٌ
 * فقراءةٌ — بلا تدخّلٍ بين طورٍ وطورٍ، وبساعةٍ مُحقَنة.
 *
 * @param {RecoveryContract} contract
 * @param {{ root: string, clock: () => number }} facts
 * @returns {Readonly<import('../../src/recovery/judgement.mjs').RecoveryJudgement & { phases: readonly PhaseRecord[], startedAt: number }>}
 */
export function runRecoveryDrill(contract, facts) {
  const paths = recoveryPaths(contract, facts.root);
  /** @type {PhaseRecord[]} */
  const phases = [];

  /**
   * @template T
   * @param {string} id
   * @param {() => T} body
   * @returns {T}
   */
  const phase = (id, body) => {
    const startedAt = facts.clock();
    assertClock(startedAt);
    const value = body();
    const endedAt = facts.clock();
    assertClock(endedAt);
    phases.push({ id, startedAt, endedAt });
    return value;
  };

  const backupDigests = phase('phase:capture', () => {
    fs.mkdirSync(paths.backup, { recursive: true });
    copyTree(paths.state, paths.backup);
    const digests = digestTree(paths.backup);
    assertBackupNotEmpty(digests);
    appendRecoveryEvent(contract, {
      root: facts.root,
      at: facts.clock(),
      type: 'recovery.backup.captured',
      detail: { files: Object.keys(digests).length },
    });
    return digests;
  });

  phase('phase:wipe', () => {
    wipeRoot(paths.restore);
    appendRecoveryEvent(contract, {
      root: facts.root,
      at: facts.clock(),
      type: 'recovery.environment.wiped',
      detail: { root: contract.source.restoreRoot },
    });
  });

  const restoredCount = phase('phase:restore', () => {
    assertCleanEnvironment(paths.restore, fs.readdirSync(paths.restore));
    const count = copyTree(paths.backup, paths.restore);
    appendRecoveryEvent(contract, {
      root: facts.root,
      at: facts.clock(),
      type: 'recovery.state.restored',
      detail: { files: count },
    });
    return count;
  });

  const integrity = phase('phase:verify', () => {
    const outcome = assertRestoredMatchesBackup(backupDigests, digestTree(paths.restore));
    // ولا يُقرأ نجاحٌ من غيابِ خطأٍ: تُقرأ الملفّاتُ المُستعادةُ فعلاً بعد المطابقة.
    let readBytes = 0;
    for (const relative of Object.keys(backupDigests)) {
      readBytes += fs.readFileSync(path.join(paths.restore, relative)).byteLength;
    }
    if (readBytes === 0) {
      throw new RecoveryError(
        RECOVERY_ERRORS.INTEGRITY_MISMATCH,
        'المُستعادُ كلُّه خاوي المحتوى — ومطابقةُ بصماتِ الفراغِ للفراغِ لا تُسمّى تعافياً.',
        { files: outcome.files },
      );
    }
    appendRecoveryEvent(contract, {
      root: facts.root,
      at: facts.clock(),
      type: 'recovery.integrity.verified',
      detail: { files: outcome.files, bytes: readBytes },
    });
    return outcome;
  });

  const sequence = assertPhaseSequence(contract, phases);
  const judgement = judgeRecovery(contract, {
    totalMs: sequence.totalMs,
    files: integrity.files,
    verified: restoredCount === integrity.files,
    phases: sequence.phases.length,
  });
  const completedAt = facts.clock();
  appendRecoveryEvent(contract, {
    root: facts.root,
    at: completedAt,
    type: 'recovery.drill.completed',
    detail: {
      verdict: judgement.verdict,
      totalMs: judgement.totalMs,
      files: judgement.files,
      maxRecoveryMs: judgement.maxRecoveryMs,
    },
  });
  writeLastDrill(contract, {
    root: facts.root,
    at: completedAt,
    verdict: judgement.verdict,
    totalMs: judgement.totalMs,
    files: judgement.files,
  });
  const first = sequence.phases[0];
  return Object.freeze({
    ...judgement,
    phases: sequence.phases,
    startedAt: first === undefined ? completedAt : first.startedAt,
  });
}
