/**
 * اختبارُ سجلِّ إقلاعِ العمالِ — إغلاقُ الدَّينِ `LIVE-45` (د) (`WL-394`).
 *
 * المعيارُ بحرفِهِ من سجلِّ الديونِ:
 *   «فرادةُ اسمِ العاملِ عقدٌ لا قيدٌ: عاملانِ باسمٍ واحدٍ يُبطلانِ ضمانَ
 *    "لم يبدأ" في `releaseUnstarted`» — والمعالجةُ: «قيدُ تفرّدٍ للعاملِ الحيِّ
 *    أو رفضٌ عند الإقلاع».
 *
 * **وما يُقيسه هذا الاختبارُ ثلاثةَ لا واحد:**
 *
 *   1. **الرفضُ عندَ الإقلاعِ عمليةً حقيقيّةً**: السكربتُ الإنتاجيُّ
 *      (‏`scripts/worker.mjs`) يُقلعُ على اسمٍ يملكُهُ عاملٌ حيٌّ فيَرفضُهُ
 *      برمزٍ مُسمّى وخروجٍ غيرِ صفريّ **قبلَ أيِّ حجزٍ** — لا بعدَهُ: فالمهمّةُ
 *      المزروعةُ في الطابورِ تبقى `scheduled` لم يمسّها المرفوضُ.
 *   2. **القيدُ ذرّيٌّ تحتَ التزامنِ**: إقلاعانِ متزامنانِ على الاسمِ نفسِه
 *      (‏`Promise.all` على القاعدةِ الحقيقيّةِ) لا يمرّانِ: واحدٌ يملكُ والآخرُ
 *      مرفوضٌ — لا نافذةَ «اقرأ ثمّ اكتب».
 *   3. **الحياةُ عقدٌ ينتهي لا حالةٌ تُفحص**: النبضةُ تُمدِّدُ الملكيّةَ،
 *      وتقادُمُها فوقَ العتبةِ يفتحُ الاسمَ لإقلاعٍ جديدٍ، وفقدُ الملكيّةِ بعدَ
 *      الأخذِ يُوقفُ العاملَ الحيَّ القديمَ برمزٍ مُسمّى قبلَ أيِّ حجزٍ جديدٍ،
 *      والتوقّفُ السليمُ يُخلي الاسمَ فورًا.
 *
 * التشغيلُ: DATABASE_URL=... node --test tests/execution/worker-registry.test.mjs
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { up } from '../../src/persistence/migrator.mjs';
import {
  WORKER_REGISTRY_ERRORS,
  WorkerRegistryError,
  createWorkerRegistry,
} from '../../src/execution/worker-registry.mjs';
import { createTaskQueue } from '../../src/execution/queue.mjs';
import { probeIsolation } from '../../src/execution/isolation.mjs';
import { KingIdentity } from '../../src/root-of-trust/index.mjs';
import { createIsolatedDatabase, databaseUrl, skipWithoutDatabase } from '../helpers/pg.mjs';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORKER_SCRIPT = path.join(ROOT, 'scripts', 'worker.mjs');
const TTL_MS = 5_000;

/**
 * بيئةُ اختبارٍ: قاعدةٌ معزولةٌ عليها الهجراتُ (ومنها `0023`)، وسجلُّ عمالٍ
 * بساعةٍ قابلةٍ للتقديمِ (اختبارُ العتبةِ)، ومجمّعٌ للطابورِ.
 * @param {import('node:test').TestContext} t
 * @param {{ now?: () => Date }} [options]
 */
async function environment(t, options = {}) {
  const db = await createIsolatedDatabase('wl394');
  await up(db.pool);
  // وصلةُ العاملِ الابنِ إلى القاعدةِ المعزولةِ نفسِها: تسجيلُه يُقاسُ حيثُ يُقرأُ.
  const base = new URL(/** @type {string} */ (databaseUrl()));
  base.pathname = `/${db.name}`;
  /** ساعةٌ قابلةٌ للتقديمِ: عقدُ العتبةِ يُقاسُ بإرجاعِها لا بانتظارِها. */
  let clock = options.now ? options.now() : new Date();
  const registry = createWorkerRegistry({
    pool: db.pool,
    ttlMs: TTL_MS,
    now: () => clock,
    log: { append: () => undefined },
  });
  t.after(async () => {
    await db.drop();
  });
  return {
    db,
    registry,
    workerUrl: base.toString(),
    queue: createTaskQueue({ pool: db.pool }),
    /** @param {number} ms */
    advance: (ms) => {
      clock = new Date(clock.getTime() + ms);
    },
    now: () => clock,
  };
}

/** @returns {string} */
const bootId = () => crypto.randomUUID();

/** رمزُ الخطأِ إن كانَ من السجلِّ، أو `null` لغيرهِ. @param {unknown} error */
function registryCode(error) {
  return error instanceof WorkerRegistryError ? error.code : null;
}

test(
  'الإقلاعُ الأولَ يملكُ الاسمَ، والإقلاعُ الثاني عليه يُرفَضُ برمزٍ مُسمّى وبلا مساسٍ بالملكِ',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const first = await env.registry.register({ worker: 'عامل-فرادة', bootId: bootId() });
    assert.equal(first.tookOver, false, 'أولُ إقلاعٍ لا يأخذُ الاسمَ من أحدٍ');
    const holder = await env.registry.readEntry('عامل-فرادة');
    assert.notEqual(holder, null, 'الملكيّةُ مسجّلةٌ في القاعدةِ لا في ذاكرةِ العمليةِ');
    await assert.rejects(
      env.registry.register({ worker: 'عامل-فرادة', bootId: bootId() }),
      (error) => {
        assert.equal(registryCode(error), WORKER_REGISTRY_ERRORS.NAME_TAKEN);
        assert.match(
          error instanceof Error ? error.message : String(error),
          /عامل-فرادة/,
          'رسالةُ الرفضِ تُسمّي الاسمَ وصاحبَهُ لا رقماً بلا نسبةٍ',
        );
        return true;
      },
    );
    const stillHolder = await env.registry.readEntry('عامل-فرادة');
    assert.notEqual(stillHolder, null, 'الرفضُ لا يمسُّ ملكيّةَ الحيِّ');
    assert.equal(
      stillHolder?.bootId,
      holder?.bootId,
      'الرفضُ لا يستبدلُ المالكَ — الحكمُ للقاعدةِ لا للساعي الثاني',
    );
  },
);

test(
  'التزامنُ: إقلاعانِ متزامنانِ على الاسمِ نفسِه — واحدٌ يملكُ والآخرُ مرفوضٌ، بلا استثناءٍ مبتلَعٍ',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const results = await Promise.allSettled([
      env.registry.register({ worker: 'عامل-السباق', bootId: bootId() }),
      env.registry.register({ worker: 'عامل-السباق', bootId: bootId() }),
      env.registry.register({ worker: 'عامل-السباق', bootId: bootId() }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'مالكٌ واحدٌ لا أكثرُ — القيدُ في القاعدةِ لا في الكودِ');
    assert.equal(rejected.length, 2, 'والآخرانِ مرفوضانِ لا صامتانِ');
    for (const r of rejected) {
      assert.equal(registryCode(r.reason), WORKER_REGISTRY_ERRORS.NAME_TAKEN);
    }
  },
);

test(
  'العتبةُ: تقادُمُ النبضةِ يفتحُ الاسمَ لإقلاعٍ جديدٍ بأخذٍ مُعلَن، والمالكُ القديمُ يُوقَفُ برمزٍ مُسمّى',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const firstBoot = bootId();
    await env.registry.register({ worker: 'عامل-العتبة', bootId: firstBoot });
    // النبضةُ تُمدِّدُ الملكيّةَ ما دامتِ الحياةُ قائمةً.
    env.advance(TTL_MS / 2);
    await env.registry.heartbeat({ worker: 'عامل-العتبة', bootId: firstBoot });
    await assert.rejects(
      env.registry.register({ worker: 'عامل-العتبة', bootId: bootId() }),
      (error) => registryCode(error) === WORKER_REGISTRY_ERRORS.NAME_TAKEN,
      'نبضةٌ حيّةٌ تمنعُ الأخذَ ولو بلغَ العمرُ نصفَ العتبةِ',
    );
    // فوقَ العتبةِ: الحياةُ انتهت، والإقلاعُ الجديدُ يأخذُ بالاسمِ صراحةً.
    env.advance(TTL_MS + 1);
    const second = await env.registry.register({ worker: 'عامل-العتبة', bootId: bootId() });
    assert.equal(second.tookOver, true, 'الأخذُ فوقَ العتبةِ مُعلَنٌ لا مستورٌ');
    // والمالكُ القديمُ يكتشفُ فقدَهُ عندَ نبضتِهِ — فلا يعملُ اثنانِ بالاسمِ نفسِه.
    await assert.rejects(
      env.registry.heartbeat({ worker: 'عامل-العتبة', bootId: firstBoot }),
      (error) => registryCode(error) === WORKER_REGISTRY_ERRORS.REGISTRATION_LOST,
    );
  },
);

test(
  'التوقّفُ السليمُ يُخلي الاسمَ فورًا: الإقلاعُ التالي لا ينتظرُ العتبةَ',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    const firstBoot = bootId();
    await env.registry.register({ worker: 'عامل-الإخلاء', bootId: firstBoot });
    const removed = await env.registry.deregister({ worker: 'عامل-الإخلاء', bootId: firstBoot });
    assert.equal(removed, 1, 'إخلاءُ ملكيّتِنا يُحذفُ صفَّها');
    assert.equal(await env.registry.readEntry('عامل-الإخلاء'), null);
    const second = await env.registry.register({ worker: 'عامل-الإخلاء', bootId: bootId() });
    assert.equal(second.tookOver, false, 'الاسمُ خالٍ فالإقلاعُ أوّلُ حياةٍ لا أخذٌ');
    // وإخلاءُ من لا يملكُ لا يمسُّ المالكَ الحاليَّ.
    const removedAgain = await env.registry.deregister({
      worker: 'عامل-الإخلاء',
      bootId: firstBoot,
    });
    assert.equal(removedAgain, 0, 'إخلاءُ إقلاعٍ سابقٍ لا يحذفُ ملكيّةَ الأحدثِ');
    assert.notEqual(await env.registry.readEntry('عامل-الإخلاء'), null);
  },
);

test(
  'الهجرةُ 0023 على قاعدةٍ قائمةٍ: الجدولُ يقومُ بالقيدِ ويُسقَطُ بالرجوعِ لا يُتركَ أثراً',
  { skip: skipWithoutDatabase },
  async (t) => {
    const env = await environment(t);
    // القيدُ مقيمٌ على الشجرةِ الحيّةِ (up فوقَ قاعدةٍ فارغةٍ): عمودٌ إلزاميُّ الوجودِ.
    const columns = await env.db.pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'state' AND table_name = 'worker_registrations'
        ORDER BY column_name`,
    );
    assert.deepEqual(
      columns.rows.map((r) => /** @type {Record<string, unknown>} */ (r)['column_name']),
      ['boot_id', 'booted_at', 'heartbeat_at', 'name'],
      'أعمدةُ الجدولِ كما هُجرَتْ',
    );
    assert.ok(
      columns.rows.every((r) => /** @type {Record<string, unknown>} */ (r)['is_nullable'] === 'NO'),
      'كلُّ الأعمدةِ NOT NULL — لا صفَّ بلا نبضةٍ ولا مُعرِّفِ إقلاعٍ',
    );
    const pk = await env.db.pool.query(
      `SELECT con.contype FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'state' AND c.relname = 'worker_registrations' AND con.contype = 'p'`,
    );
    assert.equal(pk.rows.length, 1, 'المفتاحُ الأوّليُّ على الاسمِ هو عينُ القيدِ');
    // والرجوعُ يُسقِطُ الجدولَ كاملًا — فلا يبقى شاهدَ قبرٍ.
    const { down } = await import('../../src/persistence/migrator.mjs');
    await down(env.db.pool, { steps: 1 });
    const afterDown = await env.db.pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'state' AND table_name = 'worker_registrations'`,
    );
    assert.equal(afterDown.rows[0]['n'], 0, 'الرجوعُ يُزيلُ القيدَ لا يُبقيهُ معطّلًا');
    await up(env.db.pool);
    const afterUp = await env.registry.register({ worker: 'عامل-بعد-الرجوع', bootId: bootId() });
    assert.equal(afterUp.tookOver, false, 'وإعادةُ الهجرةِ تقيمُ القيدَ من جديدٍ');
  },
);

test(
  'العمليةُ الحقيقيّة: الإقلاعُ على اسمِ عاملٍ حيٍّ يُرفَضُ بخروجٍ غيرِ صفريّ قبلَ أيِّ حجزٍ، والإخلاءُ يفتحُ الاسمَ',
  { skip: skipWithoutDatabase, timeout: 120_000 },
  async (t) => {
    const env = await environment(t);
    // مهمّةٌ مزروعةٌ **متاحةٌ بعدَ حينٍ** (١٥ ثانيةً): لا يستطيعُ أحدٌ حجزَها في
    // نافذةِ الاختبارِ الأولى، فبقاءُها `scheduled` بعدَ الرفضِ دليلٌ من
    // المهمّةِ نفسِها لا من غيابِها. ثمّ تُحصَدُ من الاسمِ المُخلى — فيُقاسُ أنّ
    // المرفوضَ لم يمسّها وأنّ المُخلى حازَها.
    const availableAt = new Date(Date.now() + 15_000);
    const seeded = await env.queue.enqueue(
      {
        action: 'اختبار.نجاح',
        target: 'موضوع/فرادة-الاسم',
        actorId: 'actor-فرادة',
        idempotencyKey: 'فرادة-الاسم',
        timeoutMs: 10_000,
        // حدُّ ذاكرةٍ يُقلعُ فيهِ Node داخلَ العزلِ فعلًا: 96 ميغابايتًا تُسقطُ إقلاعَ
        // المشغّلِ (حجوزاتُ V8 وخيوطُهُ لا تسعُ) — وهوَ ما ظهرَ حينَ صارَ العزلُ
        // متاحًا في CI (LIVE-23) بعدَ أن كانَ الاختبارُ يُقاسُ في فرعِ «غيرِ متاحٍ».
        memoryLimitMb: 1_024,
        availableAt,
      },
      { decisionId: 'decision-فرادة-الاسم' },
    );
    assert.equal(seeded.task.state, 'scheduled');
    // انتقالاتُ الإدراجِ نفسِهِ (إنشاءٌ فتفويضٌ فجدولةٌ): ما بعدَهَا يُقاسُ
    // بالمساواةِ التامّةِ — لا انتقالَ جديدٍ فوقَها يعني أنّ المرفوضَ لم يمسّ.
    const transitionsAfterEnqueue = await env.queue.transitions(seeded.task.id);
    assert.ok(transitionsAfterEnqueue.length > 0, 'الإدراجُ يقيَّدُ انتقالاتِهِ');

    /** مفتاحُ إيقافٍ حقيقيٌّ موقّعٌ بمفتاحِ ملك. */
    const king = new KingIdentity();
    const dir = registerTmpRoot(mkdtempSync(path.join(tmpdir(), 'wl394-')));
    const haltFile = path.join(dir, 'state', 'halt.json');
    const publicKey = String(king.publicKey.export({ type: 'spki', format: 'pem' }));
    fs.mkdirSync(path.dirname(haltFile), { recursive: true });
    // سجلُّ أحداثٍ فريدٌ لكلِّ عمليةٍ مولودةٍ: قفلُ السجلِّ لا يسمحُ بكاتبَينِ —
    // والرفضُ المطلوبُ قياسُهُ اسمًا لا سباقًا على قفلِ ملفٍّ.
    let spawnCount = 0;
    // كلُّ ابنٍ يُقتلُ عندَ إخفاقِ الاختبارِ أيضًا: عاملٌ لا يموتُ يُعلّقُ الملفَّ
    // كلهَ حتى مهلةِ 120 ثانيةً — والإخفاقُ في مكانٍ لا يعني أنّ الأبناءَ يُتركونَ.
    /** @type {import('node:child_process').ChildProcess[]} */
    const children = [];

    /** @param {string} name @param {number} maxTasks @param {number} pollMs */
    const spawnWorker = (name, maxTasks, pollMs) => {
      const child = spawn(
        process.execPath,
        [
          WORKER_SCRIPT,
          '--worker',
          name,
          '--max-tasks',
          String(maxTasks),
          '--poll-ms',
          String(pollMs),
          '--registration-ttl-ms',
          '3000',
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            STATE_ENV: 'ci',
            DATABASE_URL: env.workerUrl,
            HALT_FILE: haltFile,
            HALT_PUBLIC_KEY: publicKey,
            ISOLATION_LOG_FILE: path.join(dir, `worker-log-${++spawnCount}.jsonl`),
            // جذرُ المخرجاتِ تحتَ جذرِ العملِ (cwd=ROOT) لا في /tmp: عزلُ المهمّةِ
            // يشترطُ writableDir ابناً منَ workdir — وإلّا رفضَ العزلُ الإقلاعَ نفسَهُ.
            ISOLATION_OUTPUT_ROOT: path.join(
              ROOT,
              '.isolation-output',
              `wl394-${Date.now()}-${++spawnCount}`,
            ),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      children.push(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      const exited = new Promise((resolve) =>
        child.on('exit', (code) => resolve({ code, stdout, stderr })),
      );
      return { child, exited: () => exited, output: () => stdout, stderrOf: () => stderr };
    };

    try {
      // (١) العاملُ الأوّلُ يُقلعُ ويملكُ الاسمَ ويبقى حيًّا ينتظرُ (طابورٌ فيهِ مهمّةٌ
      // غيرُ متاحةٍ بعدُ — المطلوبُ حياتُه لا حصادُه). يُمهَلُ حتى يُقلعَ.
      const alive = spawnWorker('عامل-حقيقي', 0, 50);
      // الانتظارُ على صفِّ القاعدةِ نفسِهِ لا على رسالةِ الإقلاعِ: الرسالةُ
      // تُطبعُ قبلَ حلقةِ العملِ، فالملكيّةُ قد تُكتبُ لحظةً بعدَها — والقياسُ
      // على الحقيقةِ المرصودةِ (الصفُّ) لا على أثرٍ سابقٍ لها.
      const deadline = Date.now() + 20_000;
      /** @type {Awaited<ReturnType<typeof env.registry.readEntry>>} */
      let holder = null;
      while (holder === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        holder = await env.registry.readEntry('عامل-حقيقي');
      }
      assert.ok(
        alive.output().includes('عاملٌ أُقلع') || holder !== null,
        'العاملُ الأوّلُ أقلعَ وملكَ الاسمَ',
      );
      assert.notEqual(holder, null, 'الملكيّةُ في القاعدةِ لا في مخرجاتِ السكربتِ وحدَها');

      // (٢) الثاني بالاسمِ نفسِه: يُرفَضُ برمزٍ مُسمّى وخروجٍ غيرِ صفريّ.
      const rejected = spawnWorker('عامل-حقيقي', 1, 50);
      const rejectedResult = await rejected.exited();
      assert.notEqual(rejectedResult.code, 0, 'رفضُ الإقلاعِ خروجٌ غيرُ صفريّ');
      assert.match(
        rejectedResult.stderr,
        /WORKER_NAME_TAKEN|لعملٍّ حيٍّ آخرَ/,
        'الرفضُ مُسمّى لا صامتٌ',
      );
      // والمهمّةُ لم يمسّها المرفوضُ: ما زالت في الطابورِ كما زُرعت.
      const stillScheduled = await env.queue.get(seeded.task.id);
      assert.equal(stillScheduled?.state, 'scheduled', 'المرفوضُ لم يحجزْ ولم يمسّ');
      assert.deepEqual(
        await env.queue.transitions(seeded.task.id),
        transitionsAfterEnqueue,
        'ولا انتقالَ جديدٍ عليها — لا حجزَ ولا محاولةَ',
      );

      // (٣) توقّفُ الأوّلِ السليمُ يُخلي الاسمَ فورًا — فالإقلاعُ التالي يمرُّ.
      alive.child.kill('SIGTERM');
      const stopped = await alive.exited();
      assert.equal(stopped.code, 0, 'توقّفٌ سليمٌ بعدَ إخلاءِ الاسمِ');
      assert.equal(await env.registry.readEntry('عامل-حقيقي'), null, 'الاسمُ خلا فورًا');
      // (٤) الاسمُ المُخلى يُقلعُ عليه من جديدٍ — وينتظرُ المهمّةَ حتى تتاحَ فيحوزَها
      // ويُتمّها: فالمرفوضُ لم يُستهلكْ حقّةَ الحياةِ على الاسمِ.
      const third = spawnWorker('عامل-حقيقي', 1, 100);
      const thirdResult = await third.exited();
      assert.equal(thirdResult.code, 0, 'الاسمُ المُخلى يُقلعُ عليه من جديدٍ ويُتمّ المهمّةَ');
      assert.match(thirdResult.stdout, /عاملٌ أُقلع/, 'والإقلاعُ معلَنٌ');
      // المهمّةُ حُصدت محاولةً واحدةً من الاسمِ المُخلى لا من المرفوضِ — وعلى
      // العزلِ نفسِهِ قيدُ مشغّلِ CI: إن كان متاحًا فقد نجحت، وإلّا فرفضُ العزلِ
      // نفسُهُ أثرٌ معروفٌ لا فشلًا غامضًا (نمطُ `assertProcessedOnce` القائم).
      const harvested = await env.queue.get(seeded.task.id);
      assert.equal(harvested?.attempts, 1, 'محاولةٌ واحدةٌ لا اثنتانِ ولا صفرٌ');
      if (probeIsolation().available) {
        assert.equal(
          harvested?.state,
          'succeeded',
          `والمهمّةُ نجحت من الاسمِ المُخلى — مخرجاتُ العاملِ:\n${thirdResult.stdout}${thirdResult.stderr}`,
        );
      } else {
        assert.equal(harvested?.state, 'scheduled');
        assert.equal(harvested?.errorCode, 'ISOLATION_UNSUPPORTED');
      }
    } finally {
      for (const child of children) {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
      }
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
