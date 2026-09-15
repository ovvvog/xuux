// اختبارُ إغلاقِ الدَّينِ `LIVE-2`: **حدُّ الحكمِ مقيسٌ في موضعِ قراءتِه**.
//
// الدَّينُ لم يكن غيابَ الحدِّ — كان **موضعَه**: مُعلَناً في متنِ §1 وفي تعليقاتِ
// الشفرةِ وفي مَخرَجِ الطرفيّةِ، **ولا يقرؤُه من يقرأُ الحكمَ**: من فتحَ الوثيقةَ
// رأى العنوانَ ثمّ خليّةَ §2 وفيها `readiness:reported` مُجرَّداً، ومن قرأَه
// برنامجاً رآه مُجرَّداً في `--json`. **وحدٌّ بعيدٌ عن موضعِ قراءتِه حدٌّ غيرُ
// مُعلَنٍ.**
//
// ويُقاس الإغلاقُ **بالرفضِ لا بالحضورِ وحدَه**: تُحذَف الترويسةُ من التقريرِ ثمّ
// تُنزَع لاحقةُ الحكمِ، ويُشغَّل الحاجزُ في كلِّ حالةٍ — **فقاعدةٌ لم تُرَ رافضةً
// مرّةً واحدةً قاعدةٌ لا يُعرَف أتعملُ أصلاً.** والإخلالُ يُصطنَع في **الملفِّ
// نفسِه** لأنّ `guard-readiness.mjs` لا يقبل `--root`، ويُردُّ الأصلُ في
// `finally` بايتاً ببايتٍ، ويُثبَت ردُّه بمقارنةٍ في آخرِ كلِّ اختبارٍ.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadReadinessContract } from '../../src/readiness/contract.mjs';
import {
  COVERAGE_BANNER_TITLE,
  NOT_APPROVAL_CLAIMS,
  VERDICT_QUALIFIER,
} from '../../src/readiness/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const REPORT = path.join(ROOT, 'docs/READINESS_REPORT.md');
const GUARD = path.join(ROOT, 'scripts/guard-readiness.mjs');
const GENERATOR = path.join(ROOT, 'scripts/readiness-report.mjs');

/**
 * @param {string} script
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(script, args = []) {
  const outcome = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: outcome.status,
    stdout: String(outcome.stdout ?? ''),
    stderr: String(outcome.stderr ?? ''),
  };
}

/**
 * يُصطنَع الإخلالُ في التقريرِ المُقيَّدِ ثمّ يُردُّ الأصلُ حتماً.
 *
 * @param {(text: string) => string} mutate
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function guardAfterMutation(mutate) {
  const original = fs.readFileSync(REPORT, 'utf8');
  try {
    const mutated = mutate(original);
    assert.notEqual(mutated, original, 'الإخلالُ المُصطنَعُ لم يُغيِّر شيئاً فلا يُقاس رفضٌ');
    fs.writeFileSync(REPORT, mutated, 'utf8');
    return run(GUARD);
  } finally {
    fs.writeFileSync(REPORT, original, 'utf8');
    assert.equal(fs.readFileSync(REPORT, 'utf8'), original, 'الأصلُ لم يُردَّ بعدَ الإخلالِ');
  }
}

test('الحدُّ في الترويسةِ لا في القاعِ — أوّلُ خمسةِ أسطرٍ تحملُه', () => {
  const head = fs.readFileSync(REPORT, 'utf8').split('\n').slice(0, 5).join('\n');
  assert.ok(
    head.includes(COVERAGE_BANNER_TITLE),
    `ترويسةُ «${COVERAGE_BANNER_TITLE}» ليست في أوّلِ التقريرِ`,
  );
});

test('كلُّ نفيٍ حاضرٌ نصّاً — **مرّةً واحدةً** فمصدرُ الحدِّ واحدٌ لا نسختانِ', () => {
  const report = fs.readFileSync(REPORT, 'utf8');
  assert.ok(NOT_APPROVAL_CLAIMS.length >= 5, 'قائمةُ النفياتِ أقصرُ من أن تكون حدّاً');
  for (const claim of NOT_APPROVAL_CLAIMS) {
    const occurrences = report.split(claim).length - 1;
    assert.equal(
      occurrences,
      1,
      `النفيُ «${claim}» ورد ${String(occurrences)} مرّةً لا مرّةً واحدةً`,
    );
  }
});

test('قيمةُ الحكمِ في §2 مقرونةٌ بلاحقتِها — لا تُقرأُ مُجرَّدةً', () => {
  const row = fs
    .readFileSync(REPORT, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('| الحكم |'));
  assert.ok(row !== undefined, 'لا صفَّ حكمٍ في جدولِ §2');
  assert.ok(String(row).includes('readiness:reported'), 'صفُّ الحكمِ بلا قيمةٍ');
  assert.ok(
    String(row).includes(VERDICT_QUALIFIER),
    `صفُّ الحكمِ بلا لاحقةِ «${VERDICT_QUALIFIER}»`,
  );
});

test('المَخرَجُ الآليُّ يحملُ الحدَّ معَ القيمةِ — وقارئُ الآلةِ لا يُكتَم عنه', () => {
  const outcome = run(GENERATOR, ['--json']);
  assert.equal(outcome.status, 0, `المولِّدُ رفض الحالةَ القائمةَ: ${outcome.stderr}`);
  const json = /** @type {Record<string, unknown>} */ (JSON.parse(outcome.stdout));
  assert.equal(json.verdict, 'readiness:reported');
  assert.equal(json.verdictKind, 'coverage-not-approval', 'المَخرَجُ بلا نوعِ حكمٍ مُصرَّحٍ');
  assert.equal(json.verdictQualifier, VERDICT_QUALIFIER);
  assert.equal(json.banner, COVERAGE_BANNER_TITLE);
  const contract = /** @type {{ objective: { limit: string } }} */ (
    /** @type {unknown} */ (loadReadinessContract())
  );
  assert.equal(json.limit, contract.objective.limit, 'حدُّ المَخرَجِ لا يطابقُ حدَّ العقدِ');
  assert.deepEqual(
    json.doesNotImply,
    [...NOT_APPROVAL_CLAIMS],
    'نفياتُ المَخرَجِ تنزاحُ عن المتنِ',
  );
});

test('حذفُ الترويسةِ يُسقِطُ الحاجزَ بالقاعدةِ R10 — لا يمرُّ خضراءَ', () => {
  const outcome = guardAfterMutation((text) =>
    text.replace(`> ## ${COVERAGE_BANNER_TITLE}\n>\n`, ''),
  );
  assert.notEqual(outcome.status, 0, 'تقريرٌ بلا ترويسةِ حدٍّ مرَّ');
  assert.match(outcome.stderr, /R10/u);
});

test('نزعُ لاحقةِ الحكمِ من خليّةِ §2 يُسقِطُ الحاجزَ بالقاعدةِ R10', () => {
  const outcome = guardAfterMutation((text) => text.replace(` — **${VERDICT_QUALIFIER}**`, ''));
  assert.notEqual(outcome.status, 0, 'خليّةُ حكمٍ مُجرَّدةٌ مرَّت');
  assert.match(outcome.stderr, /R10/u);
});
