// اختباراتُ دالةِ القرارِ المرجعيةِ لمصفوفةِ تعافي ADR 0007-أ — التنقيحُ الثاني.
//
// **المُقيس:** أنَّ نصَّ المصفوفةِ (الملحقُ §د) حصريٌّ كاملٌ حتميٌّ كما يُطالبُ
// برهانُه: لكلِّ تركيبةٍ ممثَّلةٍ نتيجةً واحدةً، ولا تركيبةً تُعيدُ `running` من
// متنٍ لم يُثبَتْ التزامُه، ولا تركيبةً يتحققُ فيها شرطا مرحلتَينِ معًا، وكلُّ
// قيمةٍ من `C−B ∈ {سالب، 0، 1، >1}` ممثَّلةٌ. **وهذه اختباراتُ اتساقِ نصٍّ
// تصميميٍّ لا قياسُ عتادٍ ولا تمكينُ مصدرِ حداثةٍ** — الدالةُ في `docs/adr/`
// ولا يستوردها مسارُ إنتاجٍ.
//
// **الجولةُ الثانيةُ (2026-10-17):** كلُّ عضوٍ كتبَ تعدادَه خارجَ الشجرةِ (1200 و5760
// تركيبةً) ولم يجدْ مسارًا يعيدُ `running` من متنٍ غيرِ ملتزمٍ — هذه الدفعةُ تُثبِتُ
// التعدادَ نفسَه داخلَ الشجرةِ لا خارجَها.

import assert from 'node:assert/strict';
import test from 'node:test';

import { decideRecovery, resumeEligible } from '../../docs/adr/0007-annex-a-reference-decision.mjs';

/**
 * @param {Partial<import('../../docs/adr/0007-annex-a-reference-decision.mjs').RecoveryInputs>} patch
 * @returns {import('../../docs/adr/0007-annex-a-reference-decision.mjs').RecoveryInputs}
 */
function inputs(patch = {}) {
  return {
    anchor: 'ok',
    manifestPresent: true,
    manifestParseable: true,
    sealVerifies: true,
    certVerifies: true,
    attestCounterEqualsB: true,
    halted: false,
    retired: false,
    C: 10n,
    B: 10n,
    ...patch,
  };
}

/** تعدادُ كلِّ التركيباتِ الممثَّلةِ معَ نشرِ قيودِ الصلاحيةِ (متنٌ غائبٌ ⇒ بنيتهُ فاسدةٌ). */
function enumerateCombinations() {
  /** @type {import('../../docs/adr/0007-annex-a-reference-decision.mjs').RecoveryInputs[]} */
  const combos = [];
  /** @type {import('../../docs/adr/0007-annex-a-reference-decision.mjs').RecoveryInputs['anchor'][]} */
  const anchors = ['ok', 'channel-failed', 'unavailable', 'index-missing', 'attest-invalid'];
  const relations = [
    { name: 'C<B', C: 9n, B: 10n },
    { name: 'C==B', C: 10n, B: 10n },
    { name: 'C==B+1', C: 11n, B: 10n },
    { name: 'C>B+1', C: 15n, B: 10n },
  ];
  for (const anchor of anchors) {
    for (const present of [true, false]) {
      // متنٌ غائبٌ ⇒ لا تحليلَ ولا ختمَ ولا شهادةَ ولا مطابقةَ عدّادٍ
      const structureFlags = present ? [true, false] : [false];
      for (const parseable of structureFlags) {
        for (const seal of structureFlags) {
          for (const cert of structureFlags) {
            for (const attest of structureFlags) {
              for (const halted of [true, false]) {
                for (const retired of [true, false]) {
                  for (const rel of relations) {
                    combos.push(
                      inputs({
                        anchor,
                        manifestPresent: present,
                        manifestParseable: parseable,
                        sealVerifies: seal,
                        certVerifies: cert,
                        attestCounterEqualsB: attest,
                        halted,
                        retired,
                        C: anchor === 'ok' ? rel.C : null,
                        B: present ? rel.B : null,
                      }),
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return combos;
}

test('الحصريةُ والكمالُ: لكلِّ تركيبةٍ نتيجةً واحدةً ومرحلةً واحدةً — والتعدادُ كاملٌ', () => {
  const combos = enumerateCombinations();
  // 5 مرساةٍ × (غائبٌ: 1 بنيةٌ / حاضرٌ: 16 بنيةً) × 4 أعلامِ حالةٍ × 4 علاقاتٍ = 1360
  assert.equal(combos.length, 5 * (1 + 16) * 4 * 4, 'حجمُ التعدادِ كما حُسِبَ لا كما تُمُنِّي');
  const seen = new Set();
  for (const combo of combos) {
    const result = decideRecovery(combo);
    assert.equal(typeof result.state, 'string');
    assert.ok([0, 1, 2, 3].includes(result.phase));
    assert.equal(typeof result.closed, 'boolean');
    // نتيجةٌ واحدةٌ: الدالةُ حتميةٌ بالبناءِ — والاختبارُ يُثبِتُها بالتكرارِ
    const again = decideRecovery(combo);
    assert.deepEqual(again, result, 'القرارُ حتميٌّ: نفسُ التركيبةِ نفسُ النتيجةِ');
    seen.add(result.state);
  }
  // كلُّ الرموزِ الممثَّلةِ ظهرتْ في التعدادِ
  assert.deepEqual(
    [...seen].sort(),
    [
      'STATE_HALT_SOVEREIGN',
      'STATE_RETIRED',
      'STATE_TPM_ATTEST_INVALID',
      'STATE_TPM_CHANNEL_FAILED',
      'STATE_TPM_COUNTER_MISMATCH',
      'STATE_TPM_INDEX_MISSING',
      'STATE_TPM_UNAVAILABLE',
      'STATE_MANIFEST_TPM_TORN',
      'running',
    ].sort(),
  );
});

test('الثابتُ 2: لا طريقَ إلى `running` إلا `C==B` معَ متنٍ كاملِ التحققِ غيرِ موقوفٍ ولا متقاعدٍ', () => {
  const combos = enumerateCombinations();
  for (const combo of combos) {
    const result = decideRecovery(combo);
    if (result.state === 'running') {
      assert.equal(combo.anchor, 'ok');
      assert.equal(combo.manifestPresent, true);
      assert.equal(combo.manifestParseable, true);
      assert.equal(combo.sealVerifies, true);
      assert.equal(combo.certVerifies, true);
      assert.equal(combo.attestCounterEqualsB, true);
      assert.equal(combo.C, combo.B);
      assert.equal(combo.halted, false);
      assert.equal(combo.retired, false);
    }
  }
});

test('الثابتُ 1: الإيقافُ السياديُّ المُقرُّ لا يُمحى — ولا استرجاعٌ يعيدُ `running` من لقطةٍ أقدمَ', () => {
  // (أ) لقطةٌ أقدمُ بعدَ إيقافٍ مُقرٍّ: العدّادُ تقدَّمَ فوقَ متنِ اللقطةِ ⇒ إغلاقٌ لا قيامةَ
  const olderSnapshotAfterHalt = decideRecovery(inputs({ halted: true, C: 11n, B: 10n }));
  assert.equal(olderSnapshotAfterHalt.state, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(olderSnapshotAfterHalt.closed, true);
  // (ب) متنُ الإيقافِ الملتزِمُ نفسُه عندَ `C==B` ⇒ يبقى موقوفًا (لا `running`)
  const haltIntact = decideRecovery(inputs({ halted: true, C: 10n, B: 10n }));
  assert.equal(haltIntact.state, 'STATE_HALT_SOVEREIGN');
  assert.equal(haltIntact.closed, true);
  // (ج) فجوةٌ أكبرُ من واحدٍ ⇒ إغلاقٌ
  const biggerGap = decideRecovery(inputs({ C: 15n, B: 10n }));
  assert.equal(biggerGap.state, 'STATE_MANIFEST_TPM_TORN');
});

test('الاستكمالُ الخاملُ ممنوعٌ: انقطاعٌ بينَ الزيادةِ والالتزامِ ⇒ إغلاقٌ دائمًا لا استكمالَ', () => {
  const interrupted = decideRecovery(inputs({ C: 11n, B: 10n }));
  assert.equal(interrupted.state, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(interrupted.closed, true);
  // و`staged` (دليلُ تحضيرٍ) لا يُقرأُ دليلَ اكتمالٍ أبدًا: عندَ `C==B` يُهمَلُ
  // (المصفوفةُ لا تعرفُ `staged` أصلًا — وهو ما يمنعُ اعتبارَه دليلًا)
  const stagedIgnored = decideRecovery(inputs({ C: 10n, B: 10n }));
  assert.equal(stagedIgnored.state, 'running');
});

test('أسبقيةُ `retired` على `halted` (التنقيحُ الثاني): المُرحَّلُ لا يستأنفُ ولا يعملُ', () => {
  const both = decideRecovery(inputs({ halted: true, retired: true, C: 10n, B: 10n }));
  assert.equal(both.state, 'STATE_RETIRED', 'التقاعدُ يفحَصُ أولًا — والاستئنافُ لا يرفعُ تقاعدًا');
  assert.equal(both.closed, true);
  // والاستئنافُ لا يُطلَقُ إلا منَ الإيقافِ السياديِّ المجرَّدِ منَ التقاعدِ
  assert.equal(resumeEligible('STATE_HALT_SOVEREIGN'), true);
  assert.equal(resumeEligible('STATE_RETIRED'), false);
  assert.equal(resumeEligible('STATE_MANIFEST_TPM_TORN'), false);
  assert.equal(resumeEligible('running'), false);
});

test('المرحلةُ 2 قبلَ أيِّ تصنيفِ إيقافٍ: `C<B` تُغلقُ حتى لو كانَ المتنُ موقوفًا', () => {
  const forwardForgeryHalted = decideRecovery(inputs({ halted: true, C: 9n, B: 10n }));
  assert.equal(forwardForgeryHalted.state, 'STATE_TPM_COUNTER_MISMATCH');
  assert.equal(forwardForgeryHalted.phase, 2);
  const tornHalted = decideRecovery(inputs({ halted: true, C: 11n, B: 10n }));
  assert.equal(tornHalted.state, 'STATE_MANIFEST_TPM_TORN');
  assert.equal(tornHalted.phase, 2, 'التمزُّقُ يُصنَّفُ قبلَ الإيقافِ');
});

test('المرحلةُ 1: لا مسارَ إلى `running` من متنٍ بلا شهادةٍ — ولو تطابقَ العدّادُ', () => {
  const noCert = decideRecovery(inputs({ certVerifies: false, C: 10n, B: 10n }));
  assert.equal(noCert.state, 'STATE_TPM_ATTEST_INVALID');
  assert.equal(noCert.phase, 1);
  const attestMismatch = decideRecovery(inputs({ attestCounterEqualsB: false, C: 10n, B: 10n }));
  assert.equal(attestMismatch.state, 'STATE_TPM_ATTEST_INVALID');
  const unparsable = decideRecovery(inputs({ manifestParseable: false, C: 10n, B: 10n }));
  assert.equal(unparsable.state, 'STATE_TPM_ATTEST_INVALID');
});

test('المرحلةُ 0: رمزٌ واحدٌ بحسبِ السببِ الأولِ لا تجميعَ للأسبابِ', () => {
  assert.equal(
    decideRecovery(inputs({ anchor: 'channel-failed' })).state,
    'STATE_TPM_CHANNEL_FAILED',
  );
  assert.equal(decideRecovery(inputs({ anchor: 'unavailable' })).state, 'STATE_TPM_UNAVAILABLE');
  assert.equal(
    decideRecovery(inputs({ anchor: 'index-missing' })).state,
    'STATE_TPM_INDEX_MISSING',
  );
  assert.equal(
    decideRecovery(inputs({ anchor: 'attest-invalid' })).state,
    'STATE_TPM_ATTEST_INVALID',
  );
});

test('الحالاتُ المستحيلةُ تُعرَّفُ رفضًا صريحًا: `attest.counter` لا يطابقُ `B` ⇒ لا اعتبارَ لعلاقةِ العدّادِ', () => {
  // «انتقالٌ» لا تسمحُ به المصفوفةُ (متنٌ بشهادةٍ سليمةٍ وعدّادٍ متقدمٍ سابقًا
  // معَ `attest.counter ≠ B`) يُرفضُ في المرحلةِ 1 قبلَ المقارنةِ.
  const impossibleTransition = decideRecovery(
    inputs({ attestCounterEqualsB: false, C: 11n, B: 10n }),
  );
  assert.equal(impossibleTransition.state, 'STATE_TPM_ATTEST_INVALID');
  assert.equal(impossibleTransition.phase, 1);
});
