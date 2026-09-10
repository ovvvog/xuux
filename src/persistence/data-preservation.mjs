/**
 * برهانُ حفظِ البيانات عبرَ الهجراتِ على قاعدةٍ **غيرِ فارغة** — المسار `M3`،
 * الخطوة `M3.03`.
 *
 * ما أثبتَته `proveReversibility` في هذه الخطوةِ نفسِها هو انعكاسُ **المخطَّط**: أنّ
 * `up` ثمّ `down` يُعيدانِ الجداولَ والأعمدةَ والقيودَ كما كانت. وهي تعملُ على
 * قاعدةٍ فارغةٍ عمداً، ووحدةُ `catalog.mjs` تُعلنُ في رأسِها أنّها لا تلتقطُ
 * بياناتِ الجداول. فبقيَ السؤالُ الذي لم يُجَبْ: **ماذا يحدثُ للصفوفِ؟**
 *
 * والفرقُ ليس تفصيلاً. مخطَّطٌ يعودُ سليماً وجدولٌ يعودُ فارغاً هو أسوأُ
 * الحالاتِ لا أهونُها: كلُّ فحصٍ يمرُّ، والقاعدةُ تبدو صحيحةً، والبياناتُ
 * ذهبت. وقد يُعيدُ `down` العمودَ الذي أسقطَه `up` ويعودُ فارغاً — فالكتالوجُ
 * مطابقٌ حرفاً والقيمُ ضاعت.
 *
 * ## المسارُ الخطّيُّ الواحد
 *
 * الوحدةُ تمرُّ على الهجراتِ مرّةً واحدةً صاعدةً، وتُراكِمُ البياناتِ في
 * طريقِها: كلَّما أُتيحَ مخطَّطُ مستوىً زُرِعَت صفوفُه من `seed-corpus.mjs`.
 * فالهجرةُ i تُختبَرُ على قاعدةٍ فيها **كلُّ** ما زُرِعَ في 1..i−1، لا على
 * جدولٍ واحدٍ معزول. ولكلِّ i من 2 إلى الأخيرة:
 *
 *   1. صورةُ البياناتِ عندَ i−1                              ⇐ `before`
 *   2. موضعُ الرفضِ المُعلَنِ إن وُجد (انظر أدناه)
 *   3. `up --to i` ثمّ صورة                                  ⇐ `afterUp`
 *   4. `down` خطوةً واحدةً ثمّ صورة                          ⇐ `afterDown`
 *   5. المقايسةُ القاطعة: `afterDown` **يساوي** `before` صفّاً صفّاً
 *   6. `up --to i` ثانيةً ثمّ صورة                           ⇐ `afterReapply`
 *   7. المقايسةُ الثانية: `afterReapply` يساوي `afterUp`
 *   8. زرعُ صفوفِ المستوى i ليُختبَرَ ما بعدَه على قاعدةٍ أثقل
 *
 * والمقايسةُ تجري على **نصِّ الصفوفِ كلِّها** لا على عددِها: هجرةٌ تُبدّلُ قيمةً
 * في كلِّ صفٍّ ثمّ لا يُرجِعُها تراجعُها تُبقي العددَ كما هو تماماً.
 *
 * ## الرفضُ المُعلَنُ حالةُ نجاحٍ لا استثناء
 *
 * خمسُ هجراتٍ في هذا المستودعِ تُعلنُ أنّها **ترفضُ** العملَ على جدولٍ مأهولٍ
 * بصفوفٍ لا تُستوفى شروطُها (0006، 0007، 0008، 0011، 0012)، لأنّ إكمالَها كان
 * سيستلزمُ اختراعَ قيمةٍ أو حذفَ صفّ. فالبرهانُ يزرعُ الصفَّ المخالفَ قبلَ كلٍّ
 * منها، ويشترطُ ثلاثةَ أشياءٍ معاً: أن تُخفقَ الهجرةُ، وأن تكونَ رسالتُها هي
 * الرسالةَ المُعلَنةَ لا عطلاً عارضاً، وأن تكونَ الصورةُ بعدَ الإخفاقِ مطابقةً
 * لما قبلَه — أي أنّ الرفضَ **ذرّيٌّ** لم يُتلِفْ شيئاً في طريقِه.
 *
 * ## حدودٌ مُعلَنة
 *
 * - **الهجرةُ 0001 لا تُفحَصُ لحفظِ البيانات**: لا بياناتِ قبلَ المخطَّطِ الأوّل،
 *   وتراجعُها `DROP SCHEMA state CASCADE` وهو إتلافٌ مقصودٌ مُعلَن.
 * - **صفوفُ المستوى الأخيرِ لا يليها فحص**: تُزرَعُ فيُثبَتُ قبولُ المخطَّطِ لها،
 *   ولا هجرةَ بعدَها تُختبَرُ عليها.
 * - الوحدةُ لا تُنشئُ قاعدةً ولا تكتبُ تقريراً؛ تأخذُ مجمّعاً موصولاً بقاعدةٍ
 *   **فارغةٍ مخصَّصةٍ لها** وتُعيدُ وقائعَ تُطبَعُ أو تُؤكَّدُ في اختبار.
 */

import { catalogSnapshot } from './catalog.mjs';
import { dataSnapshot, diffDataSnapshots } from './data-snapshot.mjs';
import { DEFAULT_MIGRATIONS_DIR, down, loadMigrations, readApplied, up } from './migrator.mjs';
import { REFUSAL_SCENARIOS, plantRefusal, removeRefusal, seedLevel } from './seed-corpus.mjs';

/**
 * @typedef {object} RefusalOutcome
 * @property {string} title وصفُ المخالفةِ المزروعة.
 * @property {boolean} refused الهجرةُ أخفقت كما أُعلن.
 * @property {boolean} declared نصُّ الخطأِ يحملُ العلامةَ المُعلَنة.
 * @property {boolean} atomic الصورةُ بعدَ الرفضِ مطابقةٌ لما قبلَه.
 * @property {boolean} ok الشروطُ الثلاثةُ مجتمعة.
 * @property {string} message نصُّ الخطأِ كما ورد (مقتضباً).
 */

/**
 * @typedef {object} PreservationCheck
 * @property {number} version رقمُ الهجرة.
 * @property {string} name اسمُها.
 * @property {number} rowsBefore عددُ الصفوفِ في القاعدةِ قبلَ التقديم.
 * @property {number} tablesBefore عددُ الجداولِ قبلَ التقديم.
 * @property {boolean} nonEmpty القاعدةُ كانت مأهولةً فعلاً حينَ فُحِصَت.
 * @property {boolean} preserved التراجعُ أعادَ البياناتِ صفّاً صفّاً.
 * @property {boolean} deterministic إعادةُ التقديمِ أنتجت البياناتِ نفسَها.
 * @property {boolean} schemaReversible الكتالوجُ عادَ كما كان (شاهدٌ مُلازم).
 * @property {string[]} droppedColumns أعمدةٌ أسقطَها التقديمُ عمداً وأُعلن.
 * @property {RefusalOutcome | null} refusal حصيلةُ موضعِ الرفضِ إن وُجد.
 * @property {boolean} ok الحكمُ النهائيُّ لهذه الهجرة.
 * @property {{ before: string, afterUp: string, afterDown: string, afterReapply: string }} digests
 * @property {import('./data-snapshot.mjs').DataDiff[]} diff فروقُ `afterDown` عن `before`.
 * @property {{ table: string, inserted: number }[]} seeded ما زُرِعَ بعدَ هذه الهجرة.
 */

/**
 * @typedef {object} PreservationReport
 * @property {boolean} ok كلُّ الهجراتِ المفحوصةِ اجتازت.
 * @property {number} total عددُ الهجراتِ المفحوصةِ لحفظِ البيانات.
 * @property {number} passed عددُ المجتازة.
 * @property {number} refusals عددُ مواضعِ الرفضِ المُثبَتة.
 * @property {number} peakRows أكبرُ عددِ صفوفٍ بلغتْه القاعدةُ أثناءَ الفحص.
 * @property {number} finalRows عددُ الصفوفِ عندَ آخرِ هجرة.
 * @property {string} server نصُّ `version()` من الخادم.
 * @property {string} database اسمُ القاعدة.
 * @property {string} startedAt طابعُ البدءِ ISO.
 * @property {number} durationMs زمنُ الفحصِ كلِّه.
 * @property {string[]} limits حدودُ البرهانِ المُعلَنة.
 * @property {PreservationCheck[]} checks الوقائعُ لكلِّ هجرة.
 */

/**
 * @param {import('pg').Pool} pool
 * @param {string} column
 * @returns {Promise<string>}
 */
async function scalar(pool, column) {
  const result = await pool.query(`SELECT ${column} AS v`);
  const row = /** @type {Record<string, unknown>} */ (result.rows[0] ?? {});
  return String(row['v'] ?? 'غير معروف');
}

/**
 * الأعمدةُ التي كانت في الصورةِ الأولى واختفت في الثانية — تُعلَنُ في التقرير
 * لأنّ إسقاطَ عمودٍ فقدانُ بياناتٍ **مقصودٌ ومُعلَن**، وخلطُه بالفقدانِ العَرَضيِّ
 * يُفسدُ البرهانَ في الاتجاهَين.
 *
 * @param {import('./data-snapshot.mjs').DataSnapshot} before
 * @param {import('./data-snapshot.mjs').DataSnapshot} after
 * @returns {string[]}
 */
function droppedColumns(before, after) {
  /** @type {string[]} */
  const dropped = [];
  for (const [table, body] of Object.entries(before.raw)) {
    if (after.raw[table] === undefined) continue;
    const leftRows = /** @type {Record<string, unknown>[]} */ (JSON.parse(body));
    const rightRows = /** @type {Record<string, unknown>[]} */ (JSON.parse(after.raw[table]));
    if (leftRows.length === 0 || rightRows.length === 0) continue;
    const leftFirst = leftRows[0];
    const rightFirst = rightRows[0];
    if (leftFirst === undefined || rightFirst === undefined) continue;
    const rightKeys = new Set(Object.keys(rightFirst));
    for (const key of Object.keys(leftFirst)) {
      if (!rightKeys.has(key)) dropped.push(`${table}.${key}`);
    }
  }
  return dropped.sort();
}

/**
 * أَجرِ موضعَ الرفضِ المُعلَنِ لهجرةٍ واحدة.
 *
 * الصفوفُ المخالفةُ تُزرَعُ ثمّ تُنزَعُ بمعرِّفاتِها وحدَها، فتعودُ القاعدةُ إلى
 * صورتِها الأولى ويستمرُّ المسارُ الخطّيُّ كأنّ الموضعَ لم يكن.
 *
 * @param {import('pg').Pool} pool
 * @param {import('./seed-corpus.mjs').RefusalScenario} scenario
 * @param {string} dir
 * @returns {Promise<RefusalOutcome>}
 */
async function runRefusal(pool, scenario, dir) {
  await plantRefusal(pool, scenario);
  const guarded = await dataSnapshot(pool);

  let refused = false;
  let declared = false;
  let message = '';
  try {
    await up(pool, { dir, to: scenario.version, appliedBy: 'data-preservation-refusal' });
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
    declared = message.includes(scenario.marker);
  }

  const afterAttempt = await dataSnapshot(pool);
  const atomic = diffDataSnapshots(guarded, afterAttempt).length === 0;
  await removeRefusal(pool, scenario);

  return {
    title: scenario.title,
    refused,
    declared,
    atomic,
    ok: refused && declared && atomic,
    message: message.slice(0, 220),
  };
}

/**
 * أثبتْ حفظَ البياناتِ عبرَ الهجراتِ على قاعدةٍ حيّةٍ مأهولة.
 *
 * الفحصُ يتوقّفُ عندَ أوّلِ إخفاق: بعدَ ضياعِ صفٍّ تصيرُ البياناتُ التاليةُ
 * مبنيّةً على حالةٍ مشكوكٍ فيها، وإخفاقاتُها التابعةُ تُخفي السببَ الأوّل.
 *
 * @param {import('pg').Pool} pool مجمّعٌ موصولٌ بقاعدةٍ **فارغةٍ** مخصَّصةٍ للفحص.
 * @param {object} [options]
 * @param {string} [options.dir] مجلَّدُ الهجرات.
 * @param {(line: string) => void} [options.onProgress] مُستقبِلُ سطورِ التقدُّم.
 * @returns {Promise<PreservationReport>}
 */
export async function proveDataPreservation(pool, options = {}) {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const report = options.onProgress ?? (() => undefined);
  const migrations = loadMigrations(dir);
  const startedAt = new Date();
  const started = Date.now();
  const server = await scalar(pool, 'version()');
  const database = await scalar(pool, 'current_database()');

  await readApplied(pool);

  const first = migrations[0];
  if (first === undefined) throw new Error('لا هجراتِ في المجلَّد — لا شيءَ يُبرهَن.');
  await up(pool, { dir, to: first.version, appliedBy: 'data-preservation' });
  const firstSeeded = await seedLevel(pool, first.version);
  report(
    `أُسِّسَ المخطَّطُ بالهجرة ${String(first.version).padStart(4, '0')} وزُرِعَ فيه ` +
      `${firstSeeded.reduce((sum, item) => sum + item.inserted, 0)} صفّاً.`,
  );

  /** @type {PreservationCheck[]} */
  const checks = [];
  let peakRows = 0;
  let finalRows = 0;
  let refusals = 0;
  let ok = true;

  for (const migration of migrations.slice(1)) {
    const label = String(migration.version).padStart(4, '0');
    const before = await dataSnapshot(pool);
    const catalogBefore = await catalogSnapshot(pool);
    peakRows = Math.max(peakRows, before.rows);

    const scenario = REFUSAL_SCENARIOS.find((item) => item.version === migration.version);
    const refusal = scenario ? await runRefusal(pool, scenario, dir) : null;

    await up(pool, { dir, to: migration.version, appliedBy: 'data-preservation' });
    const afterUp = await dataSnapshot(pool);

    await down(pool, { dir, steps: 1 });
    const afterDown = await dataSnapshot(pool);
    const catalogAfterDown = await catalogSnapshot(pool);

    await up(pool, { dir, to: migration.version, appliedBy: 'data-preservation' });
    const afterReapply = await dataSnapshot(pool);

    const diff = diffDataSnapshots(before, afterDown);
    const preserved = diff.length === 0;
    const deterministic = diffDataSnapshots(afterUp, afterReapply).length === 0;
    const schemaReversible = catalogAfterDown === catalogBefore;
    const nonEmpty = before.rows > 0;
    const checkOk =
      preserved && deterministic && schemaReversible && nonEmpty && (refusal ? refusal.ok : true);
    if (refusal) refusals += 1;

    const seeded = checkOk ? await seedLevel(pool, migration.version) : [];
    finalRows = (await dataSnapshot(pool)).rows;
    peakRows = Math.max(peakRows, finalRows);

    checks.push({
      version: migration.version,
      name: migration.name,
      rowsBefore: before.rows,
      tablesBefore: before.tables,
      nonEmpty,
      preserved,
      deterministic,
      schemaReversible,
      droppedColumns: droppedColumns(before, afterUp),
      refusal,
      ok: checkOk,
      digests: {
        before: before.digest,
        afterUp: afterUp.digest,
        afterDown: afterDown.digest,
        afterReapply: afterReapply.digest,
      },
      diff,
      seeded,
    });

    report(
      `${checkOk ? '✅' : '⛔'} ${label} ${migration.name} — ` +
        `${before.rows} صفّاً في ${before.tables} جدولاً محفوظةٌ عبرَ up/down` +
        (refusal ? ` · رفضٌ مُعلَنٌ ${refusal.ok ? 'مُثبَت' : 'مُخفِق'}` : '') +
        (seeded.length > 0
          ? ` · زُرِعَ ${seeded.reduce((sum, item) => sum + item.inserted, 0)} صفّاً`
          : ''),
    );

    if (!checkOk) {
      ok = false;
      break;
    }
  }

  return {
    ok,
    total: checks.length,
    passed: checks.filter((check) => check.ok).length,
    refusals,
    peakRows,
    finalRows,
    server,
    database,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - started,
    limits: [
      `الهجرة ${String(first.version).padStart(4, '0')} خارجَ الفحص: لا بياناتِ قبلَ المخطَّطِ الأوّل، وتراجعُها إسقاطُ المخطَّطِ كلِّه وهو إتلافٌ مقصودٌ مُعلَن.`,
      'صفوفُ المستوى الأخيرِ تُزرَعُ ولا تُفحَص: لا هجرةَ بعدَها تُقدَّمُ عليها.',
      'البرهانُ يقيسُ الصفوفَ الموجودةَ في المخطَّطِ `state` وحدَه؛ ما خارجَه ليس بياناتِ التطبيق.',
    ],
    checks,
  };
}
