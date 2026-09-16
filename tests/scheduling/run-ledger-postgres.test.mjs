// قفلُ الشقِّ في القاعدةِ — إغلاقُ الدَينِ `D-4` (‏`WL-191`).
//
// الدعوى المُختبَرةُ: **قفلُ الشقِّ قيدٌ في القاعدةِ لا فحصٌ في الكودِ**. وفحصُ
// «هل الشقُّ محجوزٌ؟» في الكودِ يسبقُ الكتابةَ، فبينَهما فُرجةٌ تكفي لنسختينِ من
// المُجدوِلِ تقرآنِ الدفترَ فارغاً معاً ثمّ تكتبانِ معاً — فيُطلَقُ الشقُّ مرّتينِ
// ويُقرأُ الدفترُ كأنّ العملَ وقعَ مرّةً. فما يُقاسُ هنا هو أنّ **القاعدةَ**
// ترفضُ الصفَّ الثانيَ ولو خُدِعَ الفحصُ الذي في الكودِ.
//
// ويُقاسُ معه أنّ سلسلةَ التجزئةِ تُحسَبُ على القاعدةِ نفسِها: دفترٌ صحيحُ
// السلسلةِ في الذاكرةِ ومكسورُها في القاعدةِ ليس دفتراً.
//
// التشغيلُ: DATABASE_URL=... node --test tests/scheduling/run-ledger-postgres.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPostgresRepositories } from '../../src/persistence/composition.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import { ScheduledRunLedger } from '../../src/scheduling/index.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

const SLOT = Date.UTC(2026, 3, 1, 0, 0, 0);

test(
  'القاعدةُ ترفضُ حجزَ الشقِّ نفسِه مرّتينِ ولو مضى الفحصُ الذي في الكودِ',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('schedslot');
    try {
      await up(created.pool);
      const repositories = createPostgresRepositories(created.pool);
      const ledger = new ScheduledRunLedger({
        repository: /** @type {never} */ (
          /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (repositories))[
            'scheduledRuns'
          ]
        ),
      });
      const entry = {
        jobId: 'job:readiness-report',
        slotAt: SLOT,
        phase: /** @type {const} */ ('dispatched'),
        actorId: 'agent:operator-test',
        decisionId: 'pol:scheduler-dispatch-roles',
      };
      await ledger.append(entry);
      await assert.rejects(
        () => ledger.append(entry),
        (error) => {
          // الرفضُ من القاعدةِ لا من الكودِ: القيدُ مُسمّىً في الهجرةِ.
          assert.match(
            String(/** @type {{ message?: string }} */ (error).message),
            /scheduled_runs_slot_phase_unique|SCHEDULED_RUN|unique|UNIQUE/u,
          );
          return true;
        },
      );
      const rows = await created.pool.query(
        'SELECT count(*)::int AS n FROM state.scheduled_runs WHERE job_id = $1 AND slot_at = $2',
        [entry.jobId, new Date(SLOT).toISOString()],
      );
      assert.equal(Number(rows.rows[0]?.n ?? -1), 1, 'بقيَ صفّانِ لشقٍّ واحدٍ');

      // والطورُ التاليَ في الشقِّ نفسِه مقبولٌ: القفلُ على (عملٍ، شقٍّ، طورٍ) لا
      // على الشقِّ وحدَه — فحجزٌ يمنعُ كتابةَ نتيجتِه يجعلُ كلَّ عملٍ بلا حكمٍ.
      await ledger.append({ ...entry, phase: 'completed' });
      const phases = await ledger.phasesOfSlot({ jobId: entry.jobId, slotAt: SLOT });
      assert.deepEqual([...phases].sort(), ['completed', 'dispatched']);
      assert.equal(await ledger.lastCompletedSlot(entry.jobId), SLOT);

      const verified = await ledger.verify();
      assert.equal(
        verified.ok,
        true,
        `سلسلةُ الدفترِ في القاعدةِ مكسورةٌ: ${JSON.stringify(verified.faults)}`,
      );
      assert.equal(verified.rows, 2);
    } finally {
      await created.drop();
    }
  },
);

test(
  'تعديلُ صفٍّ في القاعدةِ يُكسِرُ السلسلةَ فيُقرأُ الكسرُ ولا يُقبَلُ الدفترُ',
  { skip: skipWithoutDatabase },
  async () => {
    const created = await createIsolatedDatabase('schedchain');
    try {
      await up(created.pool);
      const repositories = createPostgresRepositories(created.pool);
      const ledger = new ScheduledRunLedger({
        repository: /** @type {never} */ (
          /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (repositories))[
            'scheduledRuns'
          ]
        ),
      });
      await ledger.append({
        jobId: 'job:recovery-drill',
        slotAt: SLOT,
        phase: 'dispatched',
        actorId: 'agent:operator-test',
        decisionId: 'pol:scheduler-dispatch-roles',
        detail: { subject: 'تمرينُ الاستعادةِ' },
      });
      await ledger.append({
        jobId: 'job:recovery-drill',
        slotAt: SLOT,
        phase: 'completed',
        actorId: 'agent:operator-test',
        decisionId: 'pol:scheduler-dispatch-roles',
        detail: { verdict: 'recovery:met' },
      });
      assert.equal((await ledger.verify()).ok, true);

      // **حدٌّ مُعلَنٌ يُقاسُ هنا:** لا مُشغِّلَ في القاعدةِ يمنعُ `UPDATE` على هذا
      // الجدولِ؛ فالحمايةُ **كشفٌ** لا منعٌ. وهذا الاختبارُ يُثبِتُ أنّ الكشفَ
      // يعملُ فعلاً — لا أنّ التعديلَ مستحيلٌ.
      await created.pool.query(
        `UPDATE state.scheduled_runs SET detail = '{"verdict":"recovery:missed"}'::jsonb WHERE phase = 'completed'`,
      );
      const after = await ledger.verify();
      assert.equal(
        after.ok,
        false,
        'تعديلٌ في القاعدةِ لم يُكسِرِ السلسلةَ — فالدفترُ يُصدِّقُ ما لم يقعْ',
      );
      assert.equal(after.faults.length, 1);
      await assert.rejects(
        () => ledger.assertIntact(),
        (error) => {
          assert.equal(
            /** @type {{ code?: string }} */ (error).code,
            'SCHEDULER_LEDGER_CHAIN_BROKEN',
          );
          return true;
        },
      );
    } finally {
      await created.drop();
    }
  },
);
