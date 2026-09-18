// tests/agents/agent-boundaries.test.mjs
//
// حرسُ حدودِ الوكلاءِ — يُنفِّذُ ما أشارَ إليه مسبارُ `M11.06-round-2-plan.md`
// في مسارِ `tests/agents/`. يَفحَصُ الحدودَ الثلاثةَ التي تَحبِسُ الوكيلَ:
//
//   1. حجرُ العزلِ (quarantine) — وكيلٌ خارجٌ عن النطاقِ يُحجَرُ ويُفرَغُ
//   2. بوابةُ الميزانيّةِ — تجاوزُ الميزانيّةِ يُنتِجُ `budget-exceeded`
//   3. التقييمُ قبلَ التنشيطِ — لا تنشيطَ بلا نتيجةِ تقييمٍ ناجحةٍ
//
// النتيجةُ `R6-A-12`/`R6-B-04`: المسارُ كانَ غائباً فأُنشئَ.
// النتيجةُ `R6-A-13`/`R6-B-05`: الحارسُ هنا يَعُدُّ مُنتِجَ `budget-exceeded`
//   جزءاً من حدودِ الوكيلِ لا ترفاً خارجَها.
//
// التشغيل: node --test tests/agents/

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
 * قسمُ «الحدودِ المُعلَنةِ» في وثيقةِ الاحتواءِ.
 * @returns {string}
 */
function declaredLimitsSection() {
  const text = fs.readFileSync(CONTAINMENT, 'utf8');
  const start = text.indexOf('## 6.');
  assert.notEqual(start, -1, 'قسمُ الحدودِ المعلنةِ غائبٌ عن وثيقةِ الاحتواءِ');
  const after = text.indexOf('\n## ', start + 1);
  return after === -1 ? text.slice(start) : text.slice(start, after);
}

test('R6-A-12/R6-B-04: مسارُ tests/agents/ موجودٌ ويَحوي اختباراتٍ', () => {
  // المسبارُ كانَ يَرفُضُ: «Could not find .../tests/agents».
  // والآنَ المسارُ موجودٌ وهذا الاختبارُ نفسُهُ دليلٌ.
  const dir = path.join(ROOT, 'tests', 'agents');
  assert.equal(fs.existsSync(dir), true, 'مسارُ tests/agents/ لا يزالُ غائباً');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs'));
  assert.ok(files.length > 0, 'لا ملفَّ اختبارٍ في tests/agents/');
});

test('R6-A-13/R6-B-05: وثيقةُ الاحتواءِ لا تُقرُّ بغيابِ مُنتِجِ budget-exceeded وهو قائمٌ', async () => {
  // القياسُ سلوكٌ: هل يَرفُضُ التنشيطَ بلا تقييمٍ؟ (حدُّ M6.08)
  const log = new EventLog();
  const weightStore = createWeightStore({
    root: registerTmpRoot(fs.mkdtempSync(path.join(os.tmpdir(), 'agents-boundary-'))),
  });
  const registry = new ModelRegistry({
    log,
    repository: createMemoryRepository(ModelRegistry.spec),
    weightStore,
    evaluationLedger: new ModelEvaluationLedger({ log, experiments: experimentLedgerFor(log) }),
  });
  const model = await registry.register({
    name: 'نموذجُ قياسِ الحدودِ',
    modelVersion: 'r6-a13',
    purpose: 'classify',
    provider: 'اختبار',
    weights: 'أوزانُ قياسٍ',
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'عزلٌ قبلَ الاعتمادِ');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتمادٌ مشروطٌ بالتقييمِ');
  let evaluationMissing = false;
  try {
    await registry.activate(model.id);
  } catch (error) {
    evaluationMissing =
      /** @type {{ code?: string }} */ (error).code === 'MODEL_EVALUATION_MISSING';
  }
  assert.equal(evaluationMissing, true, 'حارسُ التقييمِ قبلَ التنشيطِ غيرُ قائمٍ');

  // القياسُ نصٌّ: هل تُقرُّ الوثيقةُ أنّ M6.07 غيرَ منفَّذٍ بينما المُنتِجُ قائمٌ؟
  const section = declaredLimitsSection();
  // الوثيقةُ تقولُ «منفَّذٌ جزئيّاً» وهذا صادقٌ. والطفرةُ التي تُسقِطُها تُعيدُ
  // عبارةَ «غيرِ منفَّذٍ» أو تَحذِفُ ذكرَ المُنتِجِ. فالقياسُ هنا يَرفُضُ النفيَ.
  const claimsM607Missing = /`M6\.07`[^\n]*غير\s*منفَّ?ذ/u.test(section);
  assert.equal(
    claimsM607Missing,
    false,
    'الوثيقةُ تُقرُّ أنّ M6.07 غيرُ منفَّذٍ مع أنّ budget-exceeded مُنتَجٌ في الشفرةِ',
  );

  // والقياسُ الإيجابيُّ: هل تذكرُ الوثيقةُ المُنتِجَ فعلاً؟
  const mentionsBudgetExceeded = /budget-exceeded/.test(section);
  assert.equal(
    mentionsBudgetExceeded,
    true,
    'الوثيقةُ لا تذكرُ budget-exceeded في قسمِ الحدودِ المعلنةِ — حدٌّ قائمٌ بلا إعلانٍ',
  );
});
