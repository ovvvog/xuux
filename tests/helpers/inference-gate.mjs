// مِسنَدُ بوابةِ الاستدلالِ للاختباراتِ — **موضعٌ واحدٌ لا موضعانِ.**
//
// كان هذا المِسنَدُ مكتوباً داخلَ `tests/inference/adapters.test.mjs` وحدَه، فلمّا
// جاءَ اختبارُ مُوائمِ `https` احتاجَ بوابةً حقيقيّةً بنموذجٍ نافذٍ ونقطةِ تفويضٍ
// حقيقيّةٍ، وكان نسخُ المِسنَدِ سيُنشئُ **مقياسينِ للبوابةِ** يفترقانِ عندَ أوّلِ
// تعديلٍ في عقدِها، فيمُرُّ اختبارٌ على مِسنَدٍ قديمٍ ويُقرأُ مروراً على البوابةِ.
// فصارَ المِسنَدُ هنا يُنادى من الاختبارَينِ، وحاجزُ `scripts/guard-inference.mjs`
// يقيسُ أنّ البوابةَ تُبنى فيه فعلاً (`createInferenceGate`) وأنّ كلَّ اختبارٍ
// يُنادِيه.
//
// **حدٌّ مُعلَنٌ:** هذا مِسنَدُ اختبارٍ لا شفرةُ إنتاجٍ: سجلُّه في الذاكرةِ
// ومستودعُ نماذجِه في الذاكرةِ، فما يُقاسُ عليه سلوكُ البوابةِ والمُوائمِ لا
// دوامُ القيدِ — ودوامُ القيدِ مقيسٌ في اختباراتِ جذرِ الثقةِ.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CostCapacity, loadCostCapacityPolicy } from '../../src/cost-capacity/index.mjs';
import { deterministicExecutor } from '../../src/inference/adapters/deterministic.mjs';
import { createInferenceGate } from '../../src/inference/inference-gate.mjs';
import { FileInferenceBudgetStore } from '../../src/inference/budget-store.mjs';
import { ModelEvaluationLedger } from '../../src/models/evaluation.mjs';
import { ModelRegistry, ModelState } from '../../src/models/model-registry.mjs';
import { createWeightStore } from '../../src/models/weight-store.mjs';
import { createMemoryRepository } from '../../src/persistence/repository-memory.mjs';
import { createPolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { EnforcementPoint } from '../../src/policy/enforcement-point.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';

import { experimentLedgerFor, registerEvaluationExperiment } from './experiment-support.mjs';

const CONFIG_DIR = path.join(process.cwd(), 'config');
const DEFAULT_INSTITUTION = 'institution:digital-administration';

/** @returns {{ events: Array<{ type: string, actor: string, payload: Record<string, unknown> }>, append: (type: string, actor: string, payload: object) => void }} */
export function memoryLog() {
  /** @type {Array<{ type: string, actor: string, payload: Record<string, unknown> }>} */
  const events = [];
  return {
    events,
    append(type, actor, payload) {
      events.push({ type, actor, payload: /** @type {Record<string, unknown>} */ (payload) });
    },
  };
}

/**
 * بوابةٌ حقيقيّةٌ بنقطةِ تفويضٍ حقيقيّةٍ وسجلِّ نماذجٍ حقيقيٍّ، ومُنفِّذُها هو
 * المُوائمُ الحتميُّ عبرَ عقدِه — فما يُقاسُ سلسلةٌ كاملةٌ لا حلقةٌ منها.
 *
 * ودوامُ الميزانيةِ ودفترُ التكلفةِ **إلزامٌ** (‏`LIM-1`): كلُّ بوابةٍ تُبنى
 * بمخزنِ قرصٍ حقيقيٍّ ودفترِ تكلفةٍ حقيقيٍّ. ومَن أراد قياسَ غيابِهما يبني
 * بوابتَه يدويّاً لا بهذا المِسنَدِ.
 *
 * @param {{ purpose?: string, execute?: (call: { model: { id: string, purpose: string }, purpose: string, input: string }) => Promise<{ output: string, usage?: Record<string, number> }>, tokensPerWindow?: number, budgetWindowMs?: number, budgetStore?: { load: () => unknown, save: (entries: Array<{ actorId: string, startedAt: number, tokens: number, cost: number }>) => unknown }, costLedger?: object, costInstitution?: string, now?: () => Date }} [options]
 */
export async function gateWithAdapter(options = {}) {
  const purpose = options.purpose ?? 'planning';
  const bundle = loadPolicyBundle();
  const log = memoryLog();
  const enforcementPoint = new EnforcementPoint({
    decisionPoint: createPolicyDecisionPoint({ bundle }),
    log: /** @type {import('../../src/root-of-trust/event-log.mjs').EventLog} */ (
      /** @type {unknown} */ (log)
    ),
    requireIdentityGate: false, // اختباراتٌ لا تُمرِّر بوابةَ هويةٍ
  });
  const evaluations = new ModelEvaluationLedger({
    log: /** @type {import('../../src/root-of-trust/event-log.mjs').EventLog} */ (
      /** @type {unknown} */ (log)
    ),
    experiments: experimentLedgerFor(
      /** @type {{ append: (type: string, actor: string, payload: object) => unknown }} */ (log),
    ),
  });
  const registry = new ModelRegistry({
    repository: createMemoryRepository(ModelRegistry.spec),
    log: /** @type {import('../../src/root-of-trust/event-log.mjs').EventLog} */ (
      /** @type {unknown} */ (log)
    ),
    weightStore: createWeightStore({
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-weights-')),
    }),
    evaluationLedger: evaluations,
  });
  const model = await registry.register({
    name: 'نموذجُ التخطيطِ',
    modelVersion: '1.0.0',
    purpose,
    provider: 'داخليٌّ',
    weights: `weights:${purpose}`,
  });
  await registry.transition(model.id, ModelState.SANDBOXED, 'اختبارٌ مقبولٌ');
  await registry.transition(model.id, ModelState.APPROVED, 'اعتمادٌ');
  evaluations.record({
    modelId: model.id,
    fingerprint: model.fingerprint,
    evaluatedBy: 'role:minister',
    experimentId: registerEvaluationExperiment(evaluations, {
      modelId: model.id,
      fingerprint: model.fingerprint,
    }),
    results: [
      { checkId: 'safety', score: 1 },
      { checkId: 'quality', score: 1 },
      { checkId: 'reliability', score: 1 },
    ],
  });
  const active = await registry.activate(model.id);

  // ── دوامُ الميزانيةِ ودفترُ التكلفةِ إلزامٌ (‏`LIM-1`، `WL-197`) ──
  // مخزنُ قرصٍ حقيقيٌّ افتراضيّاً: اختباراتُ الدوامِ تُقاسُ على ملفٍّ لا على
  // مصفوفةٍ في الذاكرةِ. ومَن أراد مخزناً مخصّصاً يُمرِّرُه.
  const budgetStore =
    options.budgetStore ??
    new FileInferenceBudgetStore({
      filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'budget-store-')), 'budget.json'),
    });

  // ── دفترُ التكلفةِ إلزامٌ (‏`LIM-1`، `WL-197`) ──
  // دفترٌ حقيقيٌّ افتراضيّاً: اختباراتُ القيدِ تُقاسُ على `CostCapacity` لا على
  // دالّةٍ مزيّفةٍ. ومَن أراد دفتراً مخصّصاً يُمرِّرُه.
  const costLedger =
    options.costLedger ??
    new CostCapacity({
      policy: loadCostCapacityPolicy({ dir: CONFIG_DIR }),
      log: /** @type {never} */ (/** @type {unknown} */ (log)),
      ledger: () => log.events.map((event) => ({ type: event.type, data: event.payload })),
      operations: null,
      nowMs: () => (options.now ? options.now().getTime() : Date.now()),
    });
  const costInstitution = options.costInstitution ?? DEFAULT_INSTITUTION;

  const gate = createInferenceGate({
    modelRegistry: registry,
    enforcementPoint,
    log: /** @type {import('../../src/root-of-trust/event-log.mjs').EventLog} */ (
      /** @type {unknown} */ (log)
    ),
    execute: options.execute ?? deterministicExecutor(),
    ...(options.tokensPerWindow === undefined ? {} : { tokensPerWindow: options.tokensPerWindow }),
    ...(options.budgetWindowMs === undefined ? {} : { budgetWindowMs: options.budgetWindowMs }),
    budgetStore,
    costLedger:
      /** @type {{ record: (usage: { item: string, quantity: number, institution: string, agent: string, model: string }, context?: { actor?: string }) => unknown }} */ (
        costLedger
      ),
    costInstitution,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { gate, log, purpose, model: active, bundle };
}

/** فاعلٌ بشكلِ عقدِ السياساتِ نفسِه؛ فاعلٌ ناقصُ حقلٍ يُرفَضُ في التفويضِ لا في المُوائمِ. */
export function minister() {
  return {
    id: 'agent:minister-adapter-1',
    role: 'role:minister',
    kind: /** @type {const} */ ('human'),
    state: 'active',
    scope: 'org:planning',
  };
}
