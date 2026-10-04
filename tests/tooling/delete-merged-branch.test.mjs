// F — حذفُ فرعِ الطلبِ المدموجِ وحدَه، والتحقّقُ من زوالِه (‏`WL-329`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { cleanupMergedBranch, decideBranchDeletion } from '../../scripts/lib/merged-branch.mjs';

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
