/**
 * مطابقةُ سلامةِ ما استُعيد ونقاءُ البيئةِ قبله — الخطوة `M10.08`.
 *
 * **الضمان `G-RECOVERY-CLEAN-ENVIRONMENT`:** الاستعادةُ لا تقع إلا في جذرٍ خالٍ
 * فعلاً؛ ووجودُ ملفٍّ واحدٍ فيه يردُّ التجربةَ ولا يُتغاضى عنه، لأنّ استعادةً
 * فوقَ حالةٍ باقيةٍ تُنجِح نفسَها بما لم تستعِده.
 *
 * **الضمان `G-RECOVERY-VERIFIED-BY-DIGEST`:** نجاحُ الاستعادةِ **مطابقةُ بصمةٍ
 * ملفّاً ملفّاً** لا غيابُ خطأٍ؛ ونسخةٌ خاويةٌ تُرَدُّ ولا تُعَدُّ نجاحاً، فإنّ
 * صفرَ ملفّاتٍ يُطابِق صفرَ ملفّاتٍ مطابقةً تامّةً وهو أسوأُ الإخفاق.
 *
 * وهذا الملفُّ **نقيٌّ**: لا يقرأ قرصاً ولا يبصم بنفسه؛ يستقبل جدولَي بصماتٍ
 * جُمِعا في `scripts/lib/recovery-facts.mjs` ويحكم عليهما.
 *
 * @module recovery/integrity
 */

import { RECOVERY_ERRORS, RecoveryError } from './errors.mjs';

/**
 * @typedef {Record<string, string>} DigestMap مسارٌ نسبيٌّ ⇒ بصمةٌ سِتّ عشريّة.
 */

/**
 * ردُّ التجربةِ إن لم يكن جذرُ الاستعادةِ خالياً عند بدءِ الاستعادة.
 *
 * @param {string} root
 * @param {string[]} entries المدخلاتُ الموجودةُ فعلاً في الجذر.
 * @returns {void}
 */
export function assertCleanEnvironment(root, entries) {
  if (entries.length > 0) {
    throw new RecoveryError(
      RECOVERY_ERRORS.ENVIRONMENT_NOT_CLEAN,
      `جذرُ الاستعادةِ «${root}» ليس خالياً (${String(entries.length)} مدخلاً) — وبيئةٌ غيرُ نظيفةٍ تُنجِح الاستعادةَ بما لم تستعِده.`,
      { root, entries: entries.slice(0, 8), count: entries.length },
    );
  }
}

/**
 * ردُّ نسخةٍ احتياطيّةٍ خاويةٍ — فصفرُ ملفّاتٍ يُطابِق صفرَ ملفّاتٍ تماماً.
 *
 * @param {DigestMap} backup
 * @returns {void}
 */
export function assertBackupNotEmpty(backup) {
  const count = Object.keys(backup).length;
  if (count === 0) {
    throw new RecoveryError(
      RECOVERY_ERRORS.BACKUP_EMPTY,
      'النسخةُ الاحتياطيّةُ بلا ملفٍّ واحدٍ — ونسخةٌ خاويةٌ ليست نسخةً، ومطابقتُها لنفسِها أتمُّ مطابقةٍ وأسوأُ إخفاق.',
      { files: 0 },
    );
  }
}

/**
 * مطابقةُ بصماتِ المُستعادِ ببصماتِ المنسوخِ ملفّاً ملفّاً.
 *
 * @param {DigestMap} backup
 * @param {DigestMap} restored
 * @returns {Readonly<{ files: number, digestOfDigests: readonly string[] }>}
 */
export function assertRestoredMatchesBackup(backup, restored) {
  assertBackupNotEmpty(backup);
  const expected = Object.keys(backup).sort();
  const found = Object.keys(restored).sort();
  if (expected.length !== found.length) {
    throw new RecoveryError(
      RECOVERY_ERRORS.RESTORE_INCOMPLETE,
      `المنسوخُ ${String(expected.length)} ملفّاً والمُستعادُ ${String(found.length)} — واستعادةٌ ناقصةٌ استعادةٌ لم تقع.`,
      { expected: expected.length, found: found.length },
    );
  }
  /** @type {string[]} */
  const missing = [];
  for (const relative of expected) {
    if (!Object.prototype.hasOwnProperty.call(restored, relative)) {
      missing.push(relative);
    }
  }
  if (missing.length > 0) {
    throw new RecoveryError(
      RECOVERY_ERRORS.RESTORE_INCOMPLETE,
      `${String(missing.length)} ملفّاً منسوخاً لا نظيرَ له في المُستعاد — أوّلُها «${String(missing[0])}».`,
      { missing: missing.slice(0, 8) },
    );
  }
  /** @type {string[]} */
  const mismatched = [];
  for (const relative of expected) {
    if (backup[relative] !== restored[relative]) {
      mismatched.push(relative);
    }
  }
  if (mismatched.length > 0) {
    throw new RecoveryError(
      RECOVERY_ERRORS.INTEGRITY_MISMATCH,
      `${String(mismatched.length)} ملفّاً مُستعاداً تخالف بصمتُه بصمةَ منسوخِه — أوّلُها «${String(mismatched[0])}»؛ ووجودُ الملفِّ ليس صحّتَه.`,
      { mismatched: mismatched.slice(0, 8) },
    );
  }
  return Object.freeze({
    files: expected.length,
    digestOfDigests: Object.freeze(
      expected.map((relative) => `${relative}:${String(backup[relative])}`),
    ),
  });
}
