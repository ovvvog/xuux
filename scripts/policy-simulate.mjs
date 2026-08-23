#!/usr/bin/env node
/**
 * أداة محاكي أثر السياسة — M4.08.
 *
 * لا تنشّط هذه الأداة المقترح ولا تكتب قاعدة البيانات: النتيجة تقرير مراجعة قبل
 * الاعتماد. قبلها كان صاحب السياسة يعرف الأثر بعد أن يقع؛ هذا المسار يجعل رفض
 * التقرير أو قبول التغيير قراراً واعياً.
 *
 * الاستخدام:
 *   node scripts/policy-simulate.mjs --proposal proposal.yaml
 *   node scripts/policy-simulate.mjs --proposal proposal.yaml --decisions decisions.jsonl
 *
 * عند غياب `--decisions` تقرأ الأداة `state.policy_decisions` عبر `DATABASE_URL`.
 * حدٌّ معلن: ملف المقترح لا يمر بمسار الاعتماد ولا توقيعه؛ هو مادة محاكاة فقط.
 */

import fs from 'node:fs';
import YAML from 'yaml';
import { createPool } from '../src/persistence/db.mjs';
import { loadPolicyBundle } from '../src/policy/loader.mjs';
import {
  readRecordedPolicyDecisions,
  recordedPolicyDecisionFromRow,
  simulatePolicyChange,
} from '../src/policy/simulator.mjs';

/** @typedef {import('../src/policy/loader.mjs').PolicyBundle} PolicyBundle */
/** @typedef {import('../src/policy/model.mjs').PolicyRecord} PolicyRecord */
/** @typedef {import('../src/policy/simulator.mjs').RecordedPolicyDecision} RecordedPolicyDecision */

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function flag(argv, name) {
  const position = argv.indexOf(name);
  if (position === -1) return undefined;
  const value = argv[position + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`القيمة بعد ${name} إلزامية.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {PolicyRecord}
 */
function policyFromUnknown(value) {
  if (!isRecord(value) || typeof value['id'] !== 'string' || value['id'].trim() === '') {
    throw new Error('POLICY_PROPOSAL_INVALID: كل سياسة مقترحة تحتاج معرّف id غير فارغ.');
  }
  return /** @type {PolicyRecord} */ (/** @type {unknown} */ (value));
}

/**
 * يقبل ملفاً فيه `policy` لسياسة واحدة، أو `policies` لمجموعة استبدالات، أو
 * سياسة مفردة في الجذر. لا يقبل ملفاً غامضاً؛ السكوت قد يحاكي مجموعة لا يقصدها
 * صاحب التغيير ثم يقدّم تقريراً صحيحاً عن السؤال الخطأ.
 * @param {string} file
 * @returns {PolicyRecord[]}
 */
function readProposal(file) {
  if (!fs.existsSync(file))
    throw new Error(`POLICY_PROPOSAL_MISSING: لا يوجد ملف المقترح: ${file}`);
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!isRecord(parsed))
    throw new Error('POLICY_PROPOSAL_INVALID: المقترح يجب أن يكون كائناً YAML.');
  if ('policy' in parsed) return [policyFromUnknown(parsed['policy'])];
  if (Array.isArray(parsed['policies'])) return parsed['policies'].map(policyFromUnknown);
  return [policyFromUnknown(parsed)];
}

/**
 * @param {PolicyBundle} baseBundle
 * @param {PolicyRecord[]} proposed
 * @returns {PolicyBundle}
 */
function bundleWithProposal(baseBundle, proposed) {
  /** @type {Map<string, PolicyRecord>} */
  const byId = new Map();
  for (const policy of proposed) {
    for (const action of policy.actions) {
      if (action !== '*' && !baseBundle.actions.has(action)) {
        throw new Error(
          `POLICY_PROPOSAL_INVALID: السياسة ${policy.id} تشير إلى فعل غير معلن: ${action}.`,
        );
      }
    }
    for (const role of policy.actors.roles ?? []) {
      if (role !== '*' && !baseBundle.roles.has(role)) {
        throw new Error(
          `POLICY_PROPOSAL_INVALID: السياسة ${policy.id} تشير إلى دور غير معلن: ${role}.`,
        );
      }
    }
    byId.set(policy.id, Object.freeze({ ...policy }));
  }
  const policies = baseBundle.policies.map((existing) => byId.get(existing.id) ?? existing);
  for (const [policyId, policy] of byId) {
    if (!baseBundle.policies.some((existing) => existing.id === policyId)) policies.push(policy);
  }
  return Object.freeze({ ...baseBundle, policies: Object.freeze(policies) });
}

/**
 * @param {unknown} value
 * @returns {RecordedPolicyDecision}
 */
function recordedFromJson(value) {
  if (!isRecord(value))
    throw new Error('POLICY_DECISIONS_INVALID: كل سطر JSONL يجب أن يكون كائناً.');
  if (!isRecord(value['request'])) {
    return recordedPolicyDecisionFromRow(value);
  }
  const request = value['request'];
  if (
    !isRecord(request['actor']) ||
    typeof request['action'] !== 'string' ||
    !isRecord(request['resource']) ||
    (request['context'] !== undefined && !isRecord(request['context']))
  ) {
    throw new Error('POLICY_DECISIONS_INVALID: request ناقص أو لا يطابق شكل طلب السياسة.');
  }
  if (typeof value['allowed'] !== 'boolean' || typeof value['code'] !== 'string') {
    throw new Error('POLICY_DECISIONS_INVALID: allowed وcode إلزاميان لكل قرار.');
  }
  return {
    request: /** @type {RecordedPolicyDecision['request']} */ (/** @type {unknown} */ (request)),
    allowed: value['allowed'],
    code: value['code'],
    policyId: typeof value['policyId'] === 'string' ? value['policyId'] : null,
    policyVersion: typeof value['policyVersion'] === 'number' ? value['policyVersion'] : null,
    recordedAt: null,
  };
}

/**
 * @param {string} file
 * @returns {RecordedPolicyDecision[]}
 */
function readDecisionsJsonl(file) {
  if (!fs.existsSync(file))
    throw new Error(`POLICY_DECISIONS_MISSING: لا يوجد ملف القرارات: ${file}`);
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) throw new Error('POLICY_DECISIONS_EMPTY: ملف القرارات JSONL فارغ.');
  return lines.map((line, index) => {
    try {
      return recordedFromJson(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`POLICY_DECISIONS_INVALID: السطر ${index + 1}: ${message}`, {
        cause: error,
      });
    }
  });
}

/**
 * @param {import('../src/policy/simulator.mjs').PolicyImpactReport} report
 * @returns {void}
 */
function printReport(report) {
  console.log('تقرير محاكاة أثر تغيير السياسة — لا سياسة فُعّلت ولا سجل عُدّل.');
  console.log(`إجمالي القرارات المقيسة: ${report.total}`);
  console.log(`تحوّل سماح إلى منع: ${report.allowToDeny}`);
  console.log(`تحوّل منع إلى سماح: ${report.denyToAllow}`);
  console.log(`لم يتغير السماح أو المنع: ${report.unchanged}`);
  if (report.examples.length === 0) {
    console.log('لا أمثلة متحوّلة في العينة المقيسة.');
    return;
  }
  console.log('أمثلة القرارات المتحوّلة (حتى 20):');
  for (const example of report.examples) {
    console.log(
      `- الفاعل ${example.actor}؛ الفعل ${example.action}؛ المورد ${example.resource}؛ ${example.beforeCode} → ${example.afterCode}.`,
    );
  }
}

/** @returns {Promise<void>} */
async function main() {
  const argv = process.argv.slice(2);
  const proposalFile = flag(argv, '--proposal');
  const decisionsFile = flag(argv, '--decisions');
  if (proposalFile === undefined) {
    throw new Error(
      'POLICY_SIMULATION_PROPOSAL_REQUIRED: مرّر --proposal <ملف yaml>. لن تعمل الأداة بتقرير صامت.',
    );
  }
  const known = new Set(['--proposal', '--decisions']);
  for (const item of argv) {
    if (item.startsWith('--') && !known.has(item)) {
      throw new Error(`POLICY_SIMULATION_ARGUMENT_UNKNOWN: وسيط غير معروف: ${item}.`);
    }
  }

  const baseBundle = loadPolicyBundle();
  const proposedBundle = bundleWithProposal(baseBundle, readProposal(proposalFile));
  if (decisionsFile !== undefined) {
    printReport(
      simulatePolicyChange({
        recorded: readDecisionsJsonl(decisionsFile),
        currentBundle: baseBundle,
        proposedBundle,
      }),
    );
    return;
  }

  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL.trim() === '') {
    throw new Error(
      'POLICY_SIMULATION_DECISIONS_REQUIRED: مرّر --decisions <ملف JSONL> أو أعلن DATABASE_URL لقراءة القرارات المسجلة.',
    );
  }
  const pool = createPool();
  try {
    const recorded = await readRecordedPolicyDecisions(pool);
    printReport(simulatePolicyChange({ recorded, currentBundle: baseBundle, proposedBundle }));
  } finally {
    await pool.end();
  }
}

main().catch((/** @type {unknown} */ error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`خطأ محاكي السياسة: ${message}`);
  process.exitCode = 1;
});
