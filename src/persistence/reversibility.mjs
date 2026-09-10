/**
 * برهانُ انعكاسِ الهجرات — المسار `M3`، الخطوة `M3.03`.
 *
 * الاختبارُ القائمُ قبلَ هذه الوحدة كان يُبرهنُ شيئاً واحداً: أنّ **تقديمَ كلِّ
 * الهجراتِ ثمّ التراجعَ عنها كلِّها** يُعيدُ القاعدةَ إلى حالتِها الأولى. وهذا
 * برهانٌ على المجموعِ لا على أفرادِه: هجرةٌ رقمُها 7 قد تُخلِّفُ فهرساً لا
 * يُسقطُه تراجعُها، ثمّ يُسقطُه تراجعُ الهجرةِ 1 حين يُلقي المخطَّطَ كلَّه
 * بـ`CASCADE`، فتمرُّ المقايسةُ الكلّيةُ ويبقى العيبُ مستوراً. ويظهرُ العيبُ
 * أوّلَ مرّةٍ في الإنتاج، حينَ يُتراجَعُ عن هجرةٍ واحدةٍ لا عن عشرين.
 *
 * فهذه الوحدةُ تُبرهنُ الانعكاسَ **لكلِّ هجرةٍ على حدة**. لكلِّ رقمٍ i:
 *
 *   1. تُلتقطُ صورةُ الكتالوجِ عندَ الحالةِ i−1            ⇐ `before`
 *   2. تُقدَّمُ الهجرةُ i وحدَها، وتُلتقطُ الصورة          ⇐ `afterUp`
 *   3. يُتراجَعُ عنها خطوةً واحدة، وتُلتقطُ الصورة         ⇐ `afterDown`
 *   4. تُعادُ الهجرةُ i ليُستكمَلَ المسار، وتُلتقطُ الصورة ⇐ `afterReapply`
 *
 * والأحكامُ الأربعةُ التي تُصدَّرُ لكلِّ هجرة:
 *
 * - `reversible`  : `afterDown === before` — التراجعُ يُعيدُ الحالةَ لا يُقاربُها.
 * - `effective`   : `afterUp !== before` — التقديمُ غيّرَ شيئاً فعلاً. بدونَ هذا
 *                   الحكمِ تمرُّ هجرةٌ فارغةٌ بامتيازٍ لأنّ تراجُعَها الفارغَ
 *                   «يُعيدُ» حالةً لم تتغيّر، فيُقرَأُ العدمُ برهاناً.
 * - `deterministic`: `afterReapply === afterUp` — التقديمُ بعدَ التراجعِ يُنتجُ
 *                   المخطَّطَ نفسَه، فالدورةُ up→down→up ليست ذاتَ أثرٍ متراكم.
 * - `bookkeeping`  : دفترُ `schema_migrations` سجّلَ الرقمَ i عندَ التقديمِ
 *                   وحذفَه عندَ التراجع، ولم يمسَّ غيرَه.
 *
 * والوحدةُ لا تكتبُ تقريراً ولا تُنشئُ قاعدة؛ تأخذُ مجمّعاً موصولاً بقاعدةٍ
 * **فارغةٍ مخصَّصةٍ لها** وتُعيدُ وقائعَ قابلةً للطبعِ أو للتأكيدِ في اختبار.
 * تشغيلُها على قاعدةٍ فيها بياناتٌ يُسقطُ مخطَّطَها: ذلك مسؤوليةُ المُنادي،
 * وهو ما يفعلُه `scripts/verify-migrations.mjs` بقاعدةٍ معزولةٍ يُنشئُها ويُسقطُها.
 */

import { createHash } from 'node:crypto';

import { catalogSnapshot } from './catalog.mjs';
import { DEFAULT_MIGRATIONS_DIR, down, loadMigrations, readApplied, up } from './migrator.mjs';

/**
 * @typedef {object} SnapshotDiff
 * @property {string} section القسمُ الذي اختلف (`schemas` أو `columns` …).
 * @property {string[]} added أسطرٌ ظهرت ولم تكن.
 * @property {string[]} removed أسطرٌ اختفت وكانت.
 */

/**
 * @typedef {object} ReversibilityCheck
 * @property {number} version رقمُ الهجرة.
 * @property {string} name اسمُها.
 * @property {string} checksum بصمةُ ملفَّيها (up و down معاً).
 * @property {boolean} reversible التراجعُ أعادَ الحالةَ إلى ما قبلَ التقديم.
 * @property {boolean} effective التقديمُ غيّرَ الكتالوجَ فعلاً.
 * @property {boolean} deterministic إعادةُ التقديمِ أنتجت المخطَّطَ نفسَه.
 * @property {boolean} bookkeeping دفترُ الهجراتِ سجّلَ ثمّ حذفَ الرقمَ وحدَه.
 * @property {boolean} ok الأحكامُ الأربعةُ صحيحةٌ جميعاً.
 * @property {{ before: string, afterUp: string, afterDown: string, afterReapply: string }} digests
 *   بصماتُ الصورِ الأربع (SHA-256 مقتضبة) — دليلٌ مختصرٌ يُطبَعُ في التقرير.
 * @property {SnapshotDiff[]} diff فروقُ `afterDown` عن `before` إن وُجدت.
 * @property {number} upMs زمنُ التقديمِ بالمللي ثانية.
 * @property {number} downMs زمنُ التراجعِ بالمللي ثانية.
 */

/**
 * @typedef {object} ReversibilityReport
 * @property {boolean} ok كلُّ الهجراتِ اجتازت.
 * @property {number} total عددُ الهجراتِ المفحوصة.
 * @property {number} passed عددُ المجتازة.
 * @property {string} server نصُّ `version()` من الخادم — إثباتُ أنّ القاعدةَ حقيقية.
 * @property {string} database اسمُ القاعدةِ التي جرى عليها الفحص.
 * @property {string} startedAt طابعُ البدءِ ISO.
 * @property {number} durationMs زمنُ الفحصِ كلِّه.
 * @property {ReversibilityCheck[]} checks الوقائعُ لكلِّ هجرة.
 */

/**
 * بصمةٌ مقتضبةٌ لصورةِ الكتالوج — للطبعِ في التقارير لا للمقايسة؛ المقايسةُ
 * تجري على النصِّ الكاملِ فلا يُبنى حكمٌ على 16 حرفاً.
 * @param {string} snapshot
 * @returns {string}
 */
function digest(snapshot) {
  return createHash('sha256').update(snapshot).digest('hex').slice(0, 16);
}

/**
 * فرِّقْ صورتَينِ قسماً قسماً، وأعِد ما زادَ وما نقص.
 * الغرضُ رسالةُ فشلٍ تقولُ **ما الذي لم يُتراجَعْ عنه**، لا «الصورتانِ مختلفتان».
 * @param {string} before
 * @param {string} after
 * @returns {SnapshotDiff[]}
 */
export function diffSnapshots(before, after) {
  /** @type {Record<string, unknown[]>} */
  const left = JSON.parse(before);
  /** @type {Record<string, unknown[]>} */
  const right = JSON.parse(after);
  /** @type {SnapshotDiff[]} */
  const diffs = [];
  for (const section of Object.keys(left)) {
    const leftRows = (left[section] ?? []).map((row) => JSON.stringify(row));
    const rightRows = (right[section] ?? []).map((row) => JSON.stringify(row));
    const leftSet = new Set(leftRows);
    const rightSet = new Set(rightRows);
    const added = rightRows.filter((row) => !leftSet.has(row));
    const removed = leftRows.filter((row) => !rightSet.has(row));
    if (added.length > 0 || removed.length > 0) {
      diffs.push({ section, added, removed });
    }
  }
  return diffs;
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function serverVersion(pool) {
  const result = await pool.query('SELECT version() AS v, current_database() AS d');
  const row = /** @type {Record<string, unknown>} */ (result.rows[0] ?? {});
  return String(row['v'] ?? 'غير معروف');
}

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<string>}
 */
async function databaseName(pool) {
  const result = await pool.query('SELECT current_database() AS d');
  const row = /** @type {Record<string, unknown>} */ (result.rows[0] ?? {});
  return String(row['d'] ?? 'غير معروف');
}

/**
 * أثبتْ انعكاسَ كلِّ هجرةٍ على حدةٍ على قاعدةٍ حيّة.
 *
 * الفحصُ يتوقّفُ عندَ أوّلِ هجرةٍ تُخفق: بعدَ إخفاقِ الانعكاسِ تصيرُ الحالةُ
 * مجهولةً، ومواصلةُ الفحصِ عليها تُنتجُ إخفاقاتٍ تابعةً تُخفي السببَ الأوّل.
 *
 * @param {import('pg').Pool} pool مجمّعٌ موصولٌ بقاعدةٍ **فارغةٍ** مخصَّصةٍ للفحص.
 * @param {object} [options]
 * @param {string} [options.dir] مجلَّدُ الهجرات.
 * @param {(line: string) => void} [options.onProgress] مُستقبِلُ سطورِ التقدُّم.
 * @returns {Promise<ReversibilityReport>}
 */
export async function proveReversibility(pool, options = {}) {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const report = options.onProgress ?? (() => undefined);
  const migrations = loadMigrations(dir);
  const startedAt = new Date();
  const started = Date.now();
  const server = await serverVersion(pool);
  const database = await databaseName(pool);

  // دفترُ الهجراتِ يُنشَأُ عندَ أوّلِ قراءةٍ له. لو تُرِكَ إنشاؤه للتقديمِ
  // الأوّلِ لظهرَ جدولُ الدفترِ نفسُه فرقاً بينَ `before` و`afterDown` في
  // الهجرةِ 0001، فيُقرَأُ عيبُ قياسٍ عيباً في الهجرة.
  await readApplied(pool);

  /** @type {ReversibilityCheck[]} */
  const checks = [];
  for (const migration of migrations) {
    const before = await catalogSnapshot(pool);

    const upStarted = Date.now();
    const upOutcome = await up(pool, { dir, to: migration.version, appliedBy: 'reversibility' });
    const upMs = Date.now() - upStarted;
    const afterUp = await catalogSnapshot(pool);
    const ledgerAfterUp = (await readApplied(pool)).map((row) => row.version);

    const downStarted = Date.now();
    const downOutcome = await down(pool, { dir, steps: 1 });
    const downMs = Date.now() - downStarted;
    const afterDown = await catalogSnapshot(pool);
    const ledgerAfterDown = (await readApplied(pool)).map((row) => row.version);

    await up(pool, { dir, to: migration.version, appliedBy: 'reversibility' });
    const afterReapply = await catalogSnapshot(pool);

    const expectedAfterUp = migrations
      .filter((item) => item.version <= migration.version)
      .map((item) => item.version);
    const expectedAfterDown = expectedAfterUp.slice(0, -1);
    const bookkeeping =
      upOutcome.applied.length === 1 &&
      upOutcome.applied[0] === migration.version &&
      downOutcome.reverted.length === 1 &&
      downOutcome.reverted[0] === migration.version &&
      ledgerAfterUp.join(',') === expectedAfterUp.join(',') &&
      ledgerAfterDown.join(',') === expectedAfterDown.join(',');

    const reversible = afterDown === before;
    const effective = afterUp !== before;
    const deterministic = afterReapply === afterUp;
    /** @type {ReversibilityCheck} */
    const check = {
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      reversible,
      effective,
      deterministic,
      bookkeeping,
      ok: reversible && effective && deterministic && bookkeeping,
      digests: {
        before: digest(before),
        afterUp: digest(afterUp),
        afterDown: digest(afterDown),
        afterReapply: digest(afterReapply),
      },
      diff: reversible ? [] : diffSnapshots(before, afterDown),
      upMs,
      downMs,
    };
    checks.push(check);
    report(
      `${check.ok ? '✅' : '⛔'} ${String(migration.version).padStart(4, '0')} ${migration.name} — ` +
        `up ${upMs}ms / down ${downMs}ms — ` +
        `${check.digests.before} →${check.digests.afterUp} →${check.digests.afterDown}`,
    );
    if (!check.ok) break;
  }

  const passed = checks.filter((check) => check.ok).length;
  return {
    ok: passed === migrations.length && checks.length === migrations.length,
    total: migrations.length,
    passed,
    server,
    database,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    checks,
  };
}
