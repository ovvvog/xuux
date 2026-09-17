// اختبارُ إغلاقِ الدَّينِ `LIVE-3`: **التأجيلُ موقوتٌ لا مفتوحٌ**.
//
// الدَّينُ أنّ التأجيلاتِ الستَّ في `config/readiness-deferrals.yaml` كانت تحمل
// **شرطَ فكٍّ مكتوباً** ولا تحمل **موعدَ سؤالٍ**: فلا يُسألُ عن تأجيلٍ متى يُراجَع،
// ولا يُقاسُ على أحدٍ فَواتُ مراجعتِه — وشرطٌ بلا موعدٍ تاريخٌ مفتوحٌ.
//
// ويُقاس الإغلاقُ **بالرفضِ لا بالقبولِ وحدَه**: لكلِّ قاعدةٍ حالةُ رفضٍ مصنوعةٌ،
// ومُطفَرةٌ (mutation) تُصطنَع في السجلِّ نفسِه فيُشغَّل الحاجزُ فيها ويُشترَط رمزُ
// خروجٍ غيرُ الصفرِ — **فقاعدةٌ لم تُرَ رافضةً مرّةً واحدةً قاعدةٌ لا يُعرَف أتعملُ
// أصلاً.** والأصلُ يُردُّ في `finally` بايتاً ببايتٍ ويُثبَت ردُّه.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadDeferralRegistry, loadReadinessContract } from '../../src/readiness/contract.mjs';
import {
  auditDeferralReviews,
  cadenceForAuthority,
  isReadableDate,
  nextReviewOn,
  RECHECK_REQUIRED_FIELDS,
  reviewIsOverdue,
} from '../../src/readiness/deferrals.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-readiness.mjs');
const DEFERRALS = path.join(ROOT, 'config/readiness-deferrals.yaml');
const POLICY = { baselineCadence: 'P3M', byAuthority: { 'model-council': 'P1M' } };

/** @param {Record<string, unknown>} record @param {string} [today] @returns {string[]} */
function codesFor(record, today = '2026-09-17') {
  return auditDeferralReviews([/** @type {any} */ (record)], { policy: POLICY, today }).map(
    (fault) => fault.code,
  );
}

/** @param {string} cadence @param {string} lastReviewedOn @returns {Record<string, unknown>} */
function recordWith(cadence, lastReviewedOn, authority = 'owner') {
  return {
    id: 'M9.99',
    authority,
    recheck: { cadence, lastReviewedOn, decidedIn: 'WL-204' },
  };
}

test('موعدُ المراجعةِ حاصلُ حسابٍ نقيٍّ لا نصٌّ مكتوبٌ بيدٍ', () => {
  assert.equal(nextReviewOn('2026-09-17', 'P3M'), '2026-12-17');
  assert.equal(nextReviewOn('2026-09-17', 'P1M'), '2026-10-17');
  // حدُّ السنةِ: من راجعَ في كانونَ الأوّلِ يُسألُ في كانونَ الثاني من السنةِ التاليةِ.
  assert.equal(nextReviewOn('2026-12-31', 'P1M'), '2027-01-31');
  assert.equal(nextReviewOn('2026-12-31', 'P3M'), '2027-03-31');
  // شهرٌ أقصرُ: الحادي والثلاثونَ يُقصَرُ إلى آخرِ الشهرِ ولا يُقذَفُ به إلى شهرٍ تالٍ.
  assert.equal(nextReviewOn('2026-01-31', 'P1M'), '2026-02-28');
  // ومُدخَلٌ لا يُقرأُ لا يُخترَعُ له موعدٌ — ولا يُقبَلُ نمطٌ بشهرٍ لا وجودَ له.
  assert.equal(nextReviewOn('2026-13-01', 'P1M'), '');
  assert.equal(nextReviewOn('2026-02-30', 'P1M'), '');
  assert.equal(isReadableDate('2026-13-01'), false);
  assert.equal(isReadableDate('2026-02-29'), false);
  assert.equal(isReadableDate('2026-09-17'), true);
  assert.equal(nextReviewOn('2026-09-17', 'P6M'), '');
});

test('الفَواتُ يُقاسُ بيومٍ يُمرَّرُ لا بساعةِ النظامِ', () => {
  assert.equal(
    reviewIsOverdue({ lastReviewedOn: '2026-09-17', cadence: 'P3M', today: '2026-12-17' }),
    false,
  );
  assert.equal(
    reviewIsOverdue({ lastReviewedOn: '2026-09-17', cadence: 'P3M', today: '2026-12-18' }),
    true,
  );
  assert.equal(
    reviewIsOverdue({ lastReviewedOn: '2026-09-17', cadence: 'P1M', today: '2026-10-18' }),
    true,
  );
});

test('وتيرةُ السلطةِ تُقرأُ من سياستِها: الأساسُ فصليٌّ ومسارُ المجلسِ شهريٌّ', () => {
  assert.equal(cadenceForAuthority(POLICY, 'owner'), 'P3M');
  assert.equal(cadenceForAuthority(POLICY, 'github'), 'P3M');
  assert.equal(cadenceForAuthority(POLICY, 'model-council'), 'P1M');
});

test('تأجيلٌ بلا قسمِ إعادةِ نظرٍ يُرفَضُ — وتأجيلٌ منضبِطٌ يمرُّ', () => {
  assert.deepEqual(codesFor({ id: 'M9.99', authority: 'owner' }), [
    'READINESS_DEFERRAL_INCOMPLETE',
  ]);
  assert.deepEqual(codesFor(recordWith('P3M', '2026-09-01')), []);
});

test('كلُّ حقلٍ من حقولِ إعادةِ النظرِ مقيسٌ بحذفِه لا موصوفٌ في تعليقٍ', () => {
  for (const field of RECHECK_REQUIRED_FIELDS) {
    const record = recordWith('P3M', '2026-09-01');
    delete (/** @type {Record<string, unknown>} */ (record.recheck)[field]);
    const codes = codesFor(record);
    assert.ok(
      codes.includes('READINESS_DEFERRAL_INCOMPLETE'),
      `حذفُ «${field}» مرَّ بلا رفضٍ — وحقلٌ لا يُرى مفقودُه حقلٌ غيرُ إلزاميٍّ فعلاً`,
    );
  }
});

test('وتيرةٌ تُخالفُ سياسةَ سلطتِها تُرفَضُ — فلا تُطالُ آجالٌ بيدِ منفِّذٍ', () => {
  assert.deepEqual(codesFor(recordWith('P3M', '2026-09-01', 'model-council')), [
    'READINESS_DEFERRAL_INCOMPLETE',
  ]);
  assert.deepEqual(codesFor(recordWith('P1M', '2026-09-01', 'model-council')), []);
});

test('موعدٌ فاتَ بلا مراجعةٍ يُوقِفُ الحكمَ برمزِه المُعلَنِ', () => {
  assert.deepEqual(codesFor(recordWith('P1M', '2026-06-01', 'model-council')), [
    'READINESS_DEFERRAL_REVIEW_OVERDUE',
  ]);
});

test('مراجعةٌ لم تقعْ لا تُؤرَّخُ: تاريخٌ مستقبَليٌّ يُرفَضُ', () => {
  assert.deepEqual(codesFor(recordWith('P3M', '2027-01-01')), ['READINESS_DEFERRAL_INCOMPLETE']);
  assert.deepEqual(codesFor(recordWith('P3M', '2026-09-17')), []);
});

test('مُدخلةُ قرارِ الوتيرةِ يجب أن توجدَ فعلاً في سجلِّ العملِ', () => {
  const faults = auditDeferralReviews([/** @type {any} */ (recordWith('P3M', '2026-09-01'))], {
    policy: POLICY,
    today: '2026-09-17',
    workLogIds: new Set(['WL-001']),
  });
  assert.deepEqual(
    faults.map((fault) => fault.code),
    ['READINESS_DEFERRAL_UNDECLARED'],
  );
});

test('السجلُّ الحقيقيُّ: كلُّ تأجيلٍ موقوتٌ ووتيرتُه من سياستِه ومُقابَلةٌ بالعقدِ', () => {
  const registry = loadDeferralRegistry();
  const contract = /** @type {Record<string, any>} */ (loadReadinessContract());
  const policy = registry.recheckPolicy;
  assert.equal(policy.baselineCadence, contract.deferralRecheck.baselineCadence);
  assert.equal(policy.decidedIn, contract.deferralRecheck.decidedIn);
  assert.deepEqual(policy.byAuthority, contract.deferralRecheck.byAuthority);
  for (const deferral of registry.deferrals) {
    assert.equal(
      deferral.recheck.cadence,
      cadenceForAuthority(policy, deferral.authority),
      `وتيرةُ ${deferral.id} خارجَ سياسةِ سلطتِها`,
    );
    assert.notEqual(nextReviewOn(deferral.recheck.lastReviewedOn, deferral.recheck.cadence), '');
  }
  // وحكمُ السجلِّ الحقيقيِّ في يومِ مراجعتِه: لا فَواتَ ولا نقصَ حقلٍ.
  assert.deepEqual(
    auditDeferralReviews(registry.deferrals, {
      policy,
      today: registry.deferrals[0]?.recheck.lastReviewedOn ?? '2026-09-17',
    }),
    [],
  );
});

test('الموعدُ مطبوعٌ في التقريرِ لا مدفونٌ في سجلٍّ', () => {
  const report = fs.readFileSync(path.join(ROOT, 'docs/READINESS_REPORT.md'), 'utf8');
  for (const needle of ['المراجعةُ القادمةُ', 'READINESS_DEFERRAL_REVIEW_OVERDUE', '2026-12-17']) {
    assert.ok(report.includes(needle), `التقريرُ لا يذكرُ «${needle}»`);
  }
});

test('مُطفَرةٌ في السجلِّ: حذفُ موعدِ تأجيلٍ يُوقِفُ الحاجزَ فعلاً', () => {
  const original = fs.readFileSync(DEFERRALS, 'utf8');
  const clean = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(clean.status, 0, `الحاجزُ رفضَ السجلَّ الأصلَ:\n${clean.stderr}`);
  try {
    // وتيرةٌ تُطال بيدٍ خارجَ سياسةِ سلطتِها — أخطرُ من حذفٍ ظاهرٍ.
    const mutated = original.replace(
      "    recheck:\n      cadence: P1M\n      lastReviewedOn: '2026-09-17'",
      "    recheck:\n      cadence: P3M\n      lastReviewedOn: '2026-09-17'",
    );
    assert.notEqual(mutated, original, 'المُطفَرةُ لم تُطبَّق — فالاختبارُ لا يقيسُ شيئاً');
    fs.writeFileSync(DEFERRALS, mutated);
    const guarded = spawnSync(process.execPath, [GUARD], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(guarded.status, 0, 'الحاجزُ مرَّ على وتيرةٍ خارجَ سياستِها');
    assert.match(guarded.stderr, /R12/u);
  } finally {
    fs.writeFileSync(DEFERRALS, original);
    assert.equal(fs.readFileSync(DEFERRALS, 'utf8'), original, 'لم يُردَّ الأصلُ بايتاً ببايتٍ');
  }
});
