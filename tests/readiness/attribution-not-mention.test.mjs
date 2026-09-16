// اختبارُ إغلاقِ الدَّينِ `LIVE-4`: **الإسنادُ يُقرأ من حقلِه والسياقُ يُسمّى سياقاً**.
//
// الدَّينُ (مُكتشَفٌ في `WL-169`) أنّ مولِّدَ `docs/READINESS_REPORT.md` كان يقرأ
// **كلَّ ذِكرٍ** لمعرِّفِ بندٍ داخلَ مُدخلةِ سجلٍّ **دليلَ تنفيذٍ له** — فذِكرُ خطوةٍ
// في سياقِ «هذه الوثيقةُ قديمةٌ» أو «هذه الخطوةُ محجوبةٌ» **يُصيِّرُها ذاتَ دليلٍ**،
// **وذِكرُ الحَجبِ ليس إنجازاً.**
//
// ويُقاس الإغلاقُ **بالرفضِ لا بالقبولِ وحدَه**: لكلِّ قاعدةٍ اختبارٌ يُثبِتُ أنّها
// **تَرفُضُ** ما كان يمرُّ قبلَها، ومُطفَرةٌ (mutation) تُصطنَع في الشفرةِ نفسِها
// فيُشغَّل الحاجزُ فيها ويُشترَط رمزُ خروجٍ غيرُ الصفرِ — **فقاعدةٌ لم تُرَ رافضةً
// مرّةً واحدةً قاعدةٌ لا يُعرَف أتعملُ أصلاً.** والأصلُ يُردُّ في `finally` بايتاً
// ببايتٍ ويُثبَت ردُّه.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadReadinessContract } from '../../src/readiness/contract.mjs';
import {
  ATTRIBUTION_FIELD_TITLE,
  attributionTextOf,
  evidenceFor,
  NEUTRAL_REFERENCE_PREFIX,
  readWorkLogEntries,
} from '../../src/readiness/evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GUARD = path.join(ROOT, 'scripts/guard-readiness.mjs');
const EVIDENCE = path.join(ROOT, 'src/readiness/evidence.mjs');

/** @param {string} body @returns {string[]} */
function kindsFor(body) {
  const entries = readWorkLogEntries(`### [2026-01-01] — WL-000 — مُدخلةُ قياسٍ\n${body}\n`);
  return evidenceFor('M4.03', {
    entries,
    roadmapRows: new Map(),
    workLogPath: 'probe',
    roadmapPath: 'probe',
  }).map((ref) => ref.kind);
}

/** @returns {{ status: number | null, stderr: string }} */
function runGuard() {
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { status: result.status, stderr: `${result.stdout}\n${result.stderr}` };
}

test('حقلُ «المسار والخطوة» يُقرأ إسناداً مُعلَناً لا ذِكراً', () => {
  assert.deepEqual(kindsFor(`- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M4.03\n- **الحالة:** تمّة`), [
    'evidence:worklog-attribution',
  ]);
});

test('ترويسةُ «المسار والخطوة» تُقرأ إسناداً كسطرِ القائمةِ', () => {
  assert.deepEqual(kindsFor(`#### ${ATTRIBUTION_FIELD_TITLE}\n\nالخطوة M4.03 والبوابة G7.`), [
    'evidence:worklog-attribution',
  ]);
});

test('ذِكرُ الحَجبِ في المتنِ يُقرأ ذِكراً سياقيّاً — لا إسناداً', () => {
  // هذا **جوهرُ الدَّينِ**: قبلَ الإغلاقِ كان النوعُ الواحدُ يجعلُ هذا الذِّكرَ
  // مساوياً لإسنادٍ مُعلَنٍ، فيُقرأ الحَجبُ إنجازاً.
  const kinds = kindsFor(
    `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nوالخطوة M4.03 محجوبةٌ لا عملَ عليها هنا.`,
  );
  assert.deepEqual(kinds, ['evidence:worklog-mention']);
  assert.ok(!kinds.includes('evidence:worklog-attribution'));
});

test('صيغةُ الإحالةِ المحيَّدةِ تُخرِجُ الذِّكرَ من الدليلِ كلِّه', () => {
  for (const body of [
    `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nووثيقةُ ${NEUTRAL_REFERENCE_PREFIX}\`M4.03\` قديمةٌ.`,
    `- **${ATTRIBUTION_FIELD_TITLE}:** لا عملَ على ${NEUTRAL_REFERENCE_PREFIX}M4.03`,
    `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nراجِعْ ${NEUTRAL_REFERENCE_PREFIX} M4.03 لاحقاً.`,
  ]) {
    assert.deepEqual(kindsFor(body), [], `صيغةٌ محيَّدةٌ قُرِئت دليلاً: ${body}`);
  }
});

test('الحيادُ للذِّكرِ لا للمُدخلةِ: ذِكرٌ محيَّدٌ وآخرُ غيرُ محيَّدٍ يُقرأ الثاني', () => {
  assert.deepEqual(
    kindsFor(
      `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n\nووثيقةُ ${NEUTRAL_REFERENCE_PREFIX}\`M4.03\` قديمةٌ، والخطوة M4.03 ذُكِرت هنا سياقاً.`,
    ),
    ['evidence:worklog-mention'],
  );
});

test('مُدخلةٌ بلا حقلِ إسنادٍ لا يُفترَض لها إسنادٌ', () => {
  assert.equal(attributionTextOf('نصٌّ بلا حقولٍ يذكرُ M4.03.'), '');
  assert.deepEqual(kindsFor('نصٌّ بلا حقولٍ يذكرُ M4.03.'), ['evidence:worklog-mention']);
});

test('حدُّ الحقلِ حدُّه: بندُ القائمةِ التالي ليس من الإسنادِ', () => {
  const text = attributionTextOf(
    `- **${ATTRIBUTION_FIELD_TITLE}:** الخطوة M9.09\n- **ما تم فعلاً:** لمسُ M4.03 عرَضاً`,
  );
  assert.ok(text.includes('M9.09'));
  assert.ok(!text.includes('M4.03'));
});

test('العقدُ والشفرةُ مصدرٌ واحدٌ للقاعدةِ لا مصدرانِ', () => {
  const contract = /** @type {Record<string, unknown>} */ (loadReadinessContract());
  const attribution = /** @type {{ fieldTitle: string, neutralReferencePrefix: string }} */ (
    contract.attribution
  );
  assert.equal(attribution.fieldTitle, ATTRIBUTION_FIELD_TITLE);
  assert.equal(attribution.neutralReferencePrefix, NEUTRAL_REFERENCE_PREFIX);
  const kinds = /** @type {{ id: string }[]} */ (contract.evidenceKinds).map((kind) => kind.id);
  assert.ok(kinds.includes('evidence:worklog-attribution'));
  assert.ok(kinds.includes('evidence:worklog-mention'));
});

test('R11 يرفض إلغاءَ التمييزِ — مُطفَرةٌ تُعيدُ قراءةَ كلِّ المتنِ إسناداً', () => {
  const original = fs.readFileSync(EVIDENCE, 'utf8');
  const needle = 'const attribution = attributionTextOf(entry.body);';
  assert.ok(original.includes(needle), 'موضعُ المُطفَرةِ غيرُ موجودٍ — فالاختبارُ لا يقيس شيئاً.');
  try {
    fs.writeFileSync(EVIDENCE, original.replace(needle, 'const attribution = entry.body;'), 'utf8');
    const { status, stderr } = runGuard();
    assert.notEqual(status, 0, 'الحاجزُ مرَّ على شفرةٍ لا تُفرِّقُ الإسنادَ من السياقِ.');
    assert.match(stderr, /R11/u);
  } finally {
    fs.writeFileSync(EVIDENCE, original, 'utf8');
  }
  assert.equal(fs.readFileSync(EVIDENCE, 'utf8'), original);
});

test('R11 يرفض إلغاءَ صيغةِ الإحالةِ المحيَّدةِ', () => {
  const original = fs.readFileSync(EVIDENCE, 'utf8');
  const needle = "export const NEUTRAL_REFERENCE_PREFIX = 'لا-إسناد:';";
  assert.ok(original.includes(needle), 'موضعُ المُطفَرةِ غيرُ موجودٍ — فالاختبارُ لا يقيس شيئاً.');
  try {
    fs.writeFileSync(
      EVIDENCE,
      original.replace(needle, "export const NEUTRAL_REFERENCE_PREFIX = 'لا-إسنادٌ-آخرُ:';"),
      'utf8',
    );
    const { status, stderr } = runGuard();
    assert.notEqual(status, 0, 'الحاجزُ مرَّ على صيغةٍ في الشفرةِ تخالفُ المُعلَنَ في العقدِ.');
    assert.match(stderr, /R11/u);
  } finally {
    fs.writeFileSync(EVIDENCE, original, 'utf8');
  }
  assert.equal(fs.readFileSync(EVIDENCE, 'utf8'), original);
});

test('التقريرُ المُقيَّدُ يُسمّي القسمَينِ ويُعلِنُ الصيغةَ المحيَّدةَ', () => {
  const report = fs.readFileSync(path.join(ROOT, 'docs/READINESS_REPORT.md'), 'utf8');
  for (const needle of ['إسناداً مُعلَناً', 'ذِكرٌ سياقيٌّ', NEUTRAL_REFERENCE_PREFIX]) {
    assert.ok(report.includes(needle), `التقريرُ لا يذكرُ «${needle}».`);
  }
});
