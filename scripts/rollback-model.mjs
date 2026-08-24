#!/usr/bin/env node
/**
 * تراجع نموذج ناشط — M6.08.
 *
 * الغرض:       يعيد النسخة المعتمدة السابقة لغرض واحد ويجعل الحالية مرجعاً عنها
 *             نهائياً، بسببٍ إلزامي وسجل أحداث.
 * المدخلات:    --purpose <غرض> --reason <سبب>.
 * المخرجات:    سطر JSON فيه المعرفان والزمن المقاس بالمللي ثانية.
 * التشغيل:     node scripts/rollback-model.mjs --purpose <غرض> --reason <سبب>
 * الاختبار:    node --test tests/tooling/rollback-model-cli.test.mjs
 * الصلاحيات:   يكتب في سجل النماذج وسجل التقييم ويمر ببوابات التفعيل.
 * المالك:      مسؤول تشغيل النماذج.
 *
 * لا يقبل الأمر سبباً افتراضياً: التراجع عملية سلامة، و«سبب غير معروف» يجعل
 * المراجعة اللاحقة عاجزة عن معرفة هل كان عيباً في النموذج أم في البيئة.
 */

import path from 'node:path';
import { createPool, createPostgresRepository, MODEL_SPEC } from '../src/persistence/index.mjs';
import { EventLog } from '../src/root-of-trust/index.mjs';
import { ModelEvaluationLedger } from '../src/models/evaluation.mjs';
import { ModelRegistry } from '../src/models/model-registry.mjs';
import { rollbackModel } from '../src/models/rollback.mjs';
import { createWeightStore } from '../src/models/weight-store.mjs';

export const ROLLBACK_MODEL_CLI_ERRORS = Object.freeze({
  ARGUMENT_INVALID: 'MODEL_ROLLBACK_ARGUMENT_INVALID',
});

/** @param {string[]} argv @returns {{ purpose: string | null, reason: string | null }} */
export function parseArgs(argv) {
  /** @type {{ purpose: string | null, reason: string | null }} */
  const parsed = { purpose: null, reason: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--purpose') parsed.purpose = argv[++index] ?? null;
    else if (argument === '--reason') parsed.reason = argv[++index] ?? null;
    else
      throw new Error(`${ROLLBACK_MODEL_CLI_ERRORS.ARGUMENT_INVALID}: وسيط غير معروف: ${argument}`);
  }
  if (typeof parsed.purpose !== 'string' || parsed.purpose.trim() === '') {
    throw new Error(`${ROLLBACK_MODEL_CLI_ERRORS.ARGUMENT_INVALID}: يلزم --purpose <غرض>.`);
  }
  if (typeof parsed.reason !== 'string' || parsed.reason.trim() === '') {
    throw new Error(
      `${ROLLBACK_MODEL_CLI_ERRORS.ARGUMENT_INVALID}: يلزم --reason <سبب> ولا يُقبل سبب فارغ.`,
    );
  }
  return parsed;
}

/**
 * ينفّذ الأمر بحقن الاعتماديات في الاختبار أو بتركيب PostgreSQL وملفات الحالة في
 * التشغيل. لا تُمرّر تفاصيل الاتصال في الوسائط؛ `DATABASE_URL` هي حدّ التشغيل.
 * @param {string[]} argv
 * @param {{ registry?: ModelRegistry, actor?: string, now?: () => number }} [deps]
 * @returns {Promise<{ purpose: string, reason: string, rolledBackId: string, restoredId: string, durationMs: number }>}
 */
export async function run(argv, deps = {}) {
  const { purpose, reason } = parseArgs(argv);
  if (deps.registry) {
    /** @type {{ registry: ModelRegistry, purpose: string, reason: string, actor?: string, now?: () => number }} */
    const input = {
      registry: deps.registry,
      purpose: String(purpose),
      reason: String(reason),
    };
    if (deps.actor !== undefined) input.actor = deps.actor;
    if (deps.now !== undefined) input.now = deps.now;
    return rollbackModel(input);
  }
  const pool = createPool();
  try {
    const log = new EventLog();
    const evaluationFile =
      process.env['MODEL_EVALUATIONS_FILE'] ??
      path.join(process.cwd(), '.state/model-evaluations.json');
    const weightsRoot = process.env['WEIGHTS_DIR'] ?? path.join(process.cwd(), '.state/weights');
    const registry = new ModelRegistry({
      log,
      repository: createPostgresRepository(pool, MODEL_SPEC),
      weightStore: createWeightStore({ root: weightsRoot }),
      evaluationLedger: new ModelEvaluationLedger({ log, file: evaluationFile }),
    });
    return await rollbackModel({ registry, purpose: String(purpose), reason: String(reason) });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((/** @type {unknown} */ error) => {
      const source = /** @type {{ code?: unknown }} */ (
        typeof error === 'object' && error !== null ? error : {}
      );
      const code = typeof source.code === 'string' ? source.code : 'MODEL_ROLLBACK_FAILED';
      console.error(`[${code}] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
