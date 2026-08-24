/**
 * اختبارات تحديد أدوات PostgreSQL وفحص فرق الإصدار — WL-022.
 *
 * سبب وجود هذه الاختبارات: الإخفاق الذي عالجه الملف ظهر على منصّة الفحص فقط،
 * ولو بقي منطق الاختيار غير مُختبَر لعاد الانحدار صامتاً. فالحُقن يجعل الاختيار
 * قابلاً للفحص على أي جهاز، والفحص القَبْليّ للإصدار يُختبَر في الاتجاهين.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
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
