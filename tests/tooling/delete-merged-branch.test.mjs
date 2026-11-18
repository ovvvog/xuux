// F — حذفُ فرعِ الطلبِ المدموجِ وحدَه، والتحقّقُ من زوالِه (‏`WL-329`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { cleanupMergedBranch, decideBranchDeletion } from '../../scripts/lib/merged-branch.mjs';
import {
  FALLBACK_DIR,
  PG_TOOL_ERRORS,
  PgToolError,
  VERSIONED_ROOT,
  assertClientNotOlder,
  envVarFor,
  majorVersionOf,
  readToolVersion,
  resolvePgTool,
} from '../../scripts/lib/pg-tools.mjs';

const SHA = 'a'.repeat(40);
const base = {
  merged: true,
  sameRepo: true,
  headRef: 'fix/x',
  prHeadSha: SHA,
  defaultBranch: 'main',
  currentRefSha: SHA,
  isProtected: false,
  otherOpenPrs: 0,
};

test('F — فرعٌ مدموجٌ رأسُه رأسُ الطلبِ يمرُّ إلى الحذف', () => {
  assert.equal(decideBranchDeletion(base).action, 'delete');
});

test('F — لا يُحذَفُ: غيرُ مدموجٍ · نسخةٌ أخرى · main · افتراضيٌّ · محميٌّ · تقدَّمَ رأسُه · مستعمَلٌ', () => {
  const cases = /** @type {const} */ ([
    [{ merged: false }, 'NOT-MERGED'],
    [{ sameRepo: false }, 'FORK'],
    [{ headRef: 'main' }, 'DEFAULT'],
    [{ headRef: 'trunk', defaultBranch: 'trunk' }, 'DEFAULT'],
    [{ isProtected: true }, 'PROTECTED'],
    [{ currentRefSha: 'b'.repeat(40) }, 'MOVED'],
    [{ otherOpenPrs: 1 }, 'IN-USE'],
  ]);
  for (const [patch, code] of cases) {
    const d = decideBranchDeletion({ ...base, ...patch });
    assert.equal(d.action, 'keep', `${code}: ${d.reason}`);
    assert.ok(d.reason.startsWith(code), d.reason);
  }
  assert.equal(decideBranchDeletion({ ...base, currentRefSha: null }).action, 'already-gone');
});

/**
 * @param {{ merged?: boolean, sha?: string | null, survives?: boolean, deleteThrows?: boolean, protectedRef?: boolean }} o
 */
function stubApi(o) {
  /** @type {string[]} */
  const calls = [];
  let present = o.sha === undefined ? SHA : o.sha;
  return {
    calls,
    api: {
      /** @param {number} n */
      async isMerged(n) {
        calls.push(`merged?${n}`);
        return o.merged ?? true;
      },
      /** @param {string} ref */
      async getRefSha(ref) {
        calls.push(`get ${ref}`);
        return present;
      },
      async isProtected() {
        return o.protectedRef ?? false;
      },
      async countOpenPrsWithHead() {
        return 0;
      },
      /** @param {string} ref */
      async deleteRef(ref) {
        calls.push(`delete ${ref}`);
        if (o.deleteThrows) throw new Error('HTTP 403');
        if (!o.survives) present = null;
      },
    },
  };
}

const event = { pr: 7, headRef: 'fix/x', prHeadSha: SHA, sameRepo: true, defaultBranch: 'main' };

test('F — الحذفُ يُتحقَّقُ منه بقراءةٍ ثانية', async () => {
  const s = stubApi({});
  const r = await cleanupMergedBranch(event, s.api);
  assert.equal(r.ok, true);
  assert.equal(r.verified, 'absent');
  assert.deepEqual(s.calls, ['merged?7', 'get fix/x', 'delete fix/x', 'get fix/x']);
});

test('F — طلبٌ غيرُ مدموجٍ (‏مقروءاً من الواجهة) لا يُستدعى له حذف', async () => {
  const s = stubApi({ merged: false });
  const r = await cleanupMergedBranch(event, s.api);
  assert.equal(r.decision.action, 'keep');
  assert.ok(!s.calls.some((c) => c.startsWith('delete')), s.calls.join(','));
});

test('F — فرعٌ محميٌّ لا يُستدعى له حذف', async () => {
  const s = stubApi({ protectedRef: true });
  const r = await cleanupMergedBranch(event, s.api);
  assert.equal(r.decision.action, 'keep');
  assert.ok(!s.calls.some((c) => c.startsWith('delete')));
});

test('F — فشلُ الحذفِ أو بقاءُ الفرعِ بعدَه فشلٌ مُعلَنٌ لا إتمامٌ مُدّعى', async () => {
  const thrown = await cleanupMergedBranch(event, stubApi({ deleteThrows: true }).api);
  assert.equal(thrown.ok, false);
  assert.match(thrown.verified, /^DELETE-FAILED/u);
  const survived = await cleanupMergedBranch(event, stubApi({ survives: true }).api);
  assert.equal(survived.ok, false);
  assert.match(survived.verified, /^STILL-PRESENT/u);
});

test('F — فرعٌ حذفَه إعدادُ المستودعِ قبلَنا: «غائبٌ» بلا حذفٍ ثانٍ', async () => {
  const s = stubApi({ sha: null });
  const r = await cleanupMergedBranch(event, s.api);
  assert.equal(r.decision.action, 'already-gone');
  assert.equal(r.ok, true);
  assert.ok(!s.calls.some((c) => c.startsWith('delete')));
});

test('F — سيرُ العمل: عندَ إغلاقِ طلبٍ مدموجٍ إلى main، وكتابةٌ في وظيفتِه وحدَها، ولا كودَ من الطلب', () => {
  const doc = parse(
    readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'delete-merged-branch.yml'),
      'utf8',
    ),
  );
  assert.deepEqual(doc.on.pull_request_target.types, ['closed']);
  assert.deepEqual(doc.on.pull_request_target.branches, ['main']);
  assert.equal(doc.permissions.contents, 'read');
  const job = doc.jobs.delete;
  assert.equal(job.if, 'github.event.pull_request.merged == true');
  assert.equal(job.permissions.contents, 'write');
  const checkout = job.steps.find((/** @type {any} */ s) =>
    String(s.uses ?? '').startsWith('actions/checkout'),
  );
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const run = job.steps.map((/** @type {any} */ s) => String(s.run ?? '')).join('\n');
  assert.match(run, /node scripts\/delete-merged-branch\.mjs/u);
  assert.doesNotMatch(
    run,
    /npm (ci|install)/u,
    'لا تثبيتَ ولا تنفيذَ لتبعيّاتٍ في وظيفةِ الكتابة.',
  );
});

// ── WL-556: دُمِجَ هنا `tests/tooling/pg-tools.test.mjs` حرفيّاً (‏أجسامُ الاختباراتِ ومساعداتُها كما هي؛ أُضيفت استيراداتُه الجديدةُ وحدَها) لتوفيرِ ملفٍّ تحتَ G1. ──
/**
 * اختبارات تحديد أدوات PostgreSQL وفحص فرق الإصدار — WL-022.
 *
 * سبب وجود هذه الاختبارات: الإخفاق الذي عالجه الملف ظهر على منصّة الفحص فقط،
 * ولو بقي منطق الاختيار غير مُختبَر لعاد الانحدار صامتاً. فالحُقن يجعل الاختيار
 * قابلاً للفحص على أي جهاز، والفحص القَبْليّ للإصدار يُختبَر في الاتجاهين.
 */

test('majorVersionOf يقرأ الإصدار الأكبر من صيَغ الأدوات والخادم', () => {
  assert.equal(majorVersionOf('pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)'), 16);
  assert.equal(majorVersionOf('18.6'), 18);
  assert.equal(majorVersionOf('PostgreSQL 18.6 on x86_64-pc-linux-musl'), 18);
  assert.equal(majorVersionOf('16'), 16);
  assert.ok(Number.isNaN(majorVersionOf('بلا رقم')));
  assert.ok(Number.isNaN(majorVersionOf('')));
});

test('resolvePgTool يختار أعلى إصدار مثبَّت لا أوّل ما يجد', () => {
  const present = new Set([
    `${VERSIONED_ROOT}/16/bin/pg_dump`,
    `${VERSIONED_ROOT}/18/bin/pg_dump`,
    `${FALLBACK_DIR}/pg_dump`,
  ]);
  const resolved = resolvePgTool('pg_dump', {
    env: {},
    exists: (p) => present.has(p),
    listVersions: () => ['16', '18', 'lost+found'],
  });
  assert.equal(resolved, `${VERSIONED_ROOT}/18/bin/pg_dump`);
});

test('resolvePgTool يرجع إلى /usr/bin إن لم يوجد تثبيت متعدّد الإصدارات', () => {
  const resolved = resolvePgTool('pg_restore', {
    env: {},
    exists: (p) => p === `${FALLBACK_DIR}/pg_restore`,
    listVersions: () => [],
  });
  assert.equal(resolved, `${FALLBACK_DIR}/pg_restore`);
});

test('resolvePgTool يفشل بخطأ مُسمّى إن غابت الأداة كلياً', () => {
  assert.throws(
    () => resolvePgTool('pg_dump', { env: {}, exists: () => false, listVersions: () => ['18'] }),
    (error) => error instanceof PgToolError && error.code === PG_TOOL_ERRORS.NOT_FOUND,
  );
});

test('متغيّر البيئة يتغلّب على الاختيار التلقائي، ومسارٌ معلَن غير موجود يفشل', () => {
  assert.equal(envVarFor('pg_dump'), 'PG_DUMP');
  const chosen = resolvePgTool('pg_dump', {
    env: { PG_DUMP: '/opt/pg/18/pg_dump' },
    exists: (p) => p === '/opt/pg/18/pg_dump',
    listVersions: () => ['16'],
  });
  assert.equal(chosen, '/opt/pg/18/pg_dump');
  assert.throws(
    () =>
      resolvePgTool('pg_dump', {
        env: { PG_DUMP: '/opt/pg/غائب' },
        exists: () => false,
        listVersions: () => ['18'],
      }),
    (error) => error instanceof PgToolError && error.code === PG_TOOL_ERRORS.NOT_FOUND,
  );
});

test('assertClientNotOlder يرفض العميل الأقدم بالرمز والنص اللذين يشرحان الإصلاح', () => {
  assert.throws(
    () =>
      assertClientNotOlder({
        toolPath: '/usr/bin/pg_dump',
        clientVersion: 'pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)',
        serverVersion: '18.6',
      }),
    (error) => {
      assert.ok(error instanceof PgToolError);
      assert.equal(error.code, PG_TOOL_ERRORS.CLIENT_OLDER_THAN_SERVER);
      assert.match(error.message, /postgresql-client-18/u);
      return true;
    },
  );
});

test('assertClientNotOlder يقبل التساوي ويقبل العميل الأحدث', () => {
  assert.deepEqual(
    assertClientNotOlder({
      toolPath: '/usr/lib/postgresql/18/bin/pg_dump',
      clientVersion: 'pg_dump (PostgreSQL) 18.6',
      serverVersion: '18.6',
    }),
    { clientMajor: 18, serverMajor: 18 },
  );
  assert.deepEqual(
    assertClientNotOlder({
      toolPath: '/usr/lib/postgresql/19/bin/pg_dump',
      clientVersion: 'pg_dump (PostgreSQL) 19.1',
      serverVersion: '18.6',
    }),
    { clientMajor: 19, serverMajor: 18 },
  );
});

test('إصدارٌ لا يُقرأ خطأٌ مُسمّى لا تخمين', () => {
  assert.throws(
    () =>
      assertClientNotOlder({
        toolPath: '/usr/bin/pg_dump',
        clientVersion: 'بلا رقم',
        serverVersion: '18.6',
      }),
    (error) => error instanceof PgToolError && error.code === PG_TOOL_ERRORS.VERSION_UNREADABLE,
  );
});

test('readToolVersion يقرأ الخرج القياسي ويفشل بخطأ مُسمّى على رمز غير صفري', async () => {
  const version = await readToolVersion('/usr/lib/postgresql/18/bin/pg_dump', async () => ({
    code: 0,
    stdout: 'pg_dump (PostgreSQL) 18.6\n',
    stderr: '',
  }));
  assert.equal(version, 'pg_dump (PostgreSQL) 18.6');
  await assert.rejects(
    readToolVersion('/usr/bin/pg_dump', async () => ({
      code: 127,
      stdout: '',
      stderr: 'not found',
    })),
    (error) => error instanceof PgToolError && error.code === PG_TOOL_ERRORS.VERSION_UNREADABLE,
  );
});
