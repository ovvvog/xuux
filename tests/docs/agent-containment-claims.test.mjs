// حرسُ صدقِ وثيقةِ الاحتواءِ في شرطِ «التقييمِ قبلَ التنشيطِ» — النتيجة `R6-B-02`.
//
// العيبُ الذي يُغلقه: `docs/AGENT_CONTAINMENT.md §6` بندُها الرابعُ كان يُقرّ أنّ
// التقييمَ قبلَ التنشيطِ **غيرُ منفَّذٍ** وأنّ شرطَ البوّابةِ «بصمةٌ وتقييمٌ» نصفُه
// قائمٌ ونصفُه لا — بينما `ModelRegistry.activate` كان **يرفضُ** التنشيطَ بلا نتيجةِ
// تقييمٍ ناجحةٍ فعلاً. فالوثيقةُ الحيّةُ كانت تصفُ ماضياً، والقارئُ يبني على نصٍّ
// أضعفَ ممّا في الشفرةِ — وهو كذبٌ في الاتّجاهِ المعاكسِ لا يقلُّ ضرراً.
//
// وليسَ العلاجُ تحريرَ سطرٍ مرّةً واحدةً: هذا الملفُّ يقيسُ **السلوكَ أولاً** ثمَّ
// يُلزمُ الوثيقةَ به في الاتّجاهينِ معاً:
//   • إن رُفعَ حارسُ التقييمِ من الشفرةِ ⇒ يسقطُ قياسُ السلوكِ.
//   • وإن أُعيدَ إلى الوثيقةِ إقرارُ «غيرِ منفَّذٍ» والحارسُ قائمٌ ⇒ يسقطُ قياسُ النصِّ.
//
// التشغيل: node --test tests/docs/agent-containment-claims.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { registerTmpRoot } from '../helpers/tmp-roots.mjs';

import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { EventLog } from '../../src/root-of-trust/event-log.mjs';
import { experimentLedgerFor } from '../helpers/experiment-support.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTAINMENT = path.join(ROOT, 'docs/AGENT_CONTAINMENT.md');

/**
 * يقيسُ هل حارسُ التقييمِ قبلَ التنشيطِ قائمٌ في الشفرةِ فعلاً.
 * @returns {Promise<boolean>} صحيحٌ إن رُفضَ تنشيطُ نموذجٍ معتمَدٍ بلا نتيجةِ تقييمٍ
 */
async function evaluationGateEnforced() {
  const log = new EventLog();
  const weightStore = createWeightStore({
    root: registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'containment-claims-'))),
  });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore,
    evaluationLedger: new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) }),
  });
  const model = await registry.register({
    name: 'نموذجُ قياسِ الحارسِ',
    modelVersion: 'r6-b-02',
    purpose: 'classify',
    provider: 'اختبار',
    weights: 'أوزانُ قياسٍ',
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'عزلٌ قبلَ الاعتمادِ');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتمادٌ مشروطٌ بالتقييمِ');
  try {
    await registry.activate(model.id);
    return false;
  } catch (error) {
    return /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_MISSING';
  }
}

/**
 * قسمُ «حدودٍ معلنةٍ» وحدَه: القياسُ على ما تُقرُّه الوثيقةُ اليومَ لا على
 * فقراتِها التاريخيّةِ.
 * @returns {string} نصُّ القسمِ
 */
function declaredLimitsSection() {
  const text = fs.readFileSync(CONTAINMENT, 'utf8');
  const start = text.indexOf('## 6.');
  assert.notEqual(start, -1, 'قسمُ الحدودِ المعلنةِ غائبٌ عن وثيقةِ الاحتواءِ');
  const after = text.indexOf('\n## ', start + 1);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

test('R6-B-02: وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ حارسٍ قائمٍ في الشفرةِ', async () => {
  const enforced = await evaluationGateEnforced();
  // القياسُ سلوكٌ لا نصٌّ: الحارسُ يُرفَضُ به التنشيطُ برمزٍ مسمّىً.
  assert.equal(enforced, true, 'تنشيطٌ بلا نتيجةِ تقييمٍ لم يُرفَضْ بـ`MODEL_EVALUATION_MISSING`');

  const section = declaredLimitsSection();
  const claimsMissing = /`M6\.08`[^\n]*غير\s*منفَّ?ذ/u.test(section);
  assert.equal(
    claimsMissing,
    false,
    'الحارسُ قائمٌ في الشفرةِ والوثيقةُ تُقرُّ أنّه غيرُ منفَّذٍ — نصٌّ يصفُ ماضياً',
  );
});

test('R6-B-02: قسمُ الحدودِ المعلنةِ يذكرُ الحدَّ القائمَ في سندِ التقييمِ لا ينفيه', () => {
  const section = declaredLimitsSection();
  // الحدُّ الحقيقيُّ الباقي: سندُ النتيجةِ مخزنُه ملفٌّ أو ذاكرةٌ لا جدولٌ، وهو
  // دَينٌ مكتوبٌ؛ فإن حُذفَ ذكرُه صارتِ الوثيقةُ تُطمئنُ أكثرَ ممّا تَملِك.
  assert.match(
    section,
    /`M6\.08`/u,
    'شرطُ التقييمِ قبلَ التنشيطِ سقطَ من قسمِ الحدودِ المعلنةِ بلا بديلٍ',
  );
});

// ── R6-A-13/R6-B-05: تمديدُ الحارسِ ليشملَ M6.07 (مُنتِجُ budget-exceeded) ──
//
// العيبُ الذي يُغلقُه: الحارسُ كانَ يَفحَصُ M6.08 (التقييمَ قبلَ التنشيطِ) وحدَه،
// ولا يَفحَصُ M6.07 (بوابةَ الاستدلالِ ومُنتِجَ budget-exceeded). فطفرةٌ تُعيدُ
// عبارةَ «budget-exceeded بلا مُنتِجٍ» في قسمِ M6.07 تَمرُّ بلا أن يَسقُطَ الحارسُ.
// وهذا الحدُّ قائمٌ في `src/inference/inference-gate.mjs` منذُ `R6-B-01`.

test('R6-A-13/R6-B-05: وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ مُنتِجِ budget-exceeded وهو قائمٌ', () => {
  const section = declaredLimitsSection();
  // القياسُ نصٌّ: هل تُقرُّ الوثيقةُ أنّ M6.07 غيرَ منفَّذٍ بينما المُنتِجُ قائمٌ؟
  const claimsM607Missing = /`M6\.07`[^\n]*غير\s*منفَّ?ذ/u.test(section);
  assert.equal(
    claimsM607Missing,
    false,
    'الوثيقةُ تُقرُّ أنّ M6.07 غيرُ منفَّذٍ مع أنّ budget-exceeded مُنتَجٌ في الشفرةِ',
  );
});

test('R6-A-13/R6-B-05: قسمُ الحدودِ المعلنةِ يذكرُ مُنتِجَ budget-exceeded لا ينفيه', () => {
  const section = declaredLimitsSection();
  // الحدُّ القائمُ: إشارةُ budget-exceeded مُنتَجةٌ فعلاً في inference-gate.mjs.
  // فإن حُذفَ ذكرُها صارتِ الوثيقةُ تُطمئنُ أكثرَ ممّا تَملِك.
  assert.match(
    section,
    /budget-exceeded/u,
    'مُنتِجُ budget-exceeded سقطَ من قسمِ الحدودِ المعلنةِ بلا بديلٍ',
  );
});
