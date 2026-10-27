/**
 * اختبارات محاكي أثر السياسة — M4.08.
 *
 * الاختبار يكتب قرارات حقيقية في المصرف ثم يقرأها منه؛ تمرير مصفوفة مصطنعة وحدها
 * لا يثبت أن أعمدة الفاعل والمورد والسياق تحفظ ما يلزم لإعادة التقييم.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import { up } from '../../src/persistence/migrator.mjs';
import {
  createPolicyDecisionSink,
  readRecordedPolicyDecisions,
  simulatePolicyChange,
} from '../../src/policy/simulator.mjs';
import { createIsolatedDatabase, skipWithoutDatabase } from '../helpers/pg.mjs';

/** @typedef {import('../../src/policy/model.mjs').PolicyRecord} PolicyRecord */

/**
 * @param {readonly PolicyRecord[]} policies
 * @param {string} id
 * @returns {PolicyRecord}
 */
function policyById(policies, id) {
  const policy = policies.find((candidate) => candidate.id === id);
  if (policy === undefined) throw new Error(`سياسة اختبار مفقودة: ${id}`);
  return policy;
}

test(
  'المحاكي يقرأ القرارات المسجلة ويظهر السماح والمنع المتحوّلين',
  { skip: skipWithoutDatabase },
  async () => {
    const isolated = await createIsolatedDatabase('polsim');
    try {
      await up(isolated.pool, { appliedBy: 'tests:policy-simulator' });
      const currentBundle = loadPolicyBundle();
      const point = new PolicyDecisionPoint({ bundle: currentBundle });
      const sink = createPolicyDecisionSink({ pool: isolated.pool });

      const allowedRequest = {
        actor: {
          id: 'agent:sim-operator',
          role: 'role:operator',
          state: 'active',
          scope: 'institution:tech',
        },
        action: 'read-registry',
        resource: { type: 'registry', id: 'agents' },
      };
      const deniedRequest = {
        actor: {
          id: 'agent:sim-operator',
          role: 'role:operator',
          state: 'active',
          scope: 'institution:tech',
        },
        action: 'write-memory',
        resource: { type: 'memory', id: 'shared', scope: 'institution:other' },
      };
      await sink({ decision: point.evaluate(allowedRequest), request: allowedRequest });
      await sink({ decision: point.evaluate(deniedRequest), request: deniedRequest });

      const denyRead = policyById(currentBundle.policies, 'pol:read-registry-authorized-roles');
      const denyReadProposal = {
        ...denyRead,
        effect: /** @type {const} */ ('deny'),
        priority: 1_000,
        reason: 'اختبار محاكاة: القراءة تتحول من سماح إلى منع.',
      };
      /** @type {PolicyRecord} */
      const memoryAllowance = {
        id: 'pol:simulation-allow-memory',
        name: 'سماح محاكاة كتابة الذاكرة',
        owner: 'crown',
        version: 1,
        effect: 'allow',
        priority: 800,
        reason: 'اختبار محاكاة: كتابة ذاكرة المورد المختبر تتحول إلى سماح.',
        enabled: true,
        approvedBy: 'crown',
        actors: { roles: ['role:operator'] },
        actions: ['write-memory'],
        resources: ['memory:shared'],
      };
      const proposedPolicies = [denyReadProposal, memoryAllowance];
      const replacement = new Map(proposedPolicies.map((policy) => [policy.id, policy]));
      const proposedBundle = Object.freeze({
        ...currentBundle,
        policies: Object.freeze([
          ...currentBundle.policies.map((policy) => replacement.get(policy.id) ?? policy),
          memoryAllowance,
        ]),
      });

      const recorded = await readRecordedPolicyDecisions(isolated.pool);
      const report = simulatePolicyChange({ recorded, currentBundle, proposedBundle });
      assert.equal(report.total, 2);
      assert.equal(report.allowToDeny, 1);
      assert.equal(report.denyToAllow, 1);
      assert.equal(report.unchanged, 0);
      assert.equal(report.examples.length, 2);
      assert.deepEqual(report.examples.map((example) => example.action).sort(), [
        'read-registry',
        'write-memory',
      ]);
    } finally {
      await isolated.drop();
    }
  },
);

test('R6-A-07 (جولتا 7 و8): أثرُ السياسةِ السياديّةِ يظهرُ في المحاكاةِ رغمَ تأجيلِ المحرّكِ', () => {
  // بعدَ إصلاحِ `R6-A-07` يعودُ الفعلُ السياديُّ المأذونُ به بالسياسةِ منَ المحرّكِ
  // تأجيلًا (`allowed: false` و`policyAllows: true`) — ولو قورنَ بالإذنِ النافذِ
  // وحدهِ لصارَ تحويلُ سماحِ السياسةِ إلى منعِها «بلا أثرٍ»، ولتخفّى تغييراتُ
  // العتبةِ السياديّةِ عن تقريرِ الأثرِ كليًا. فهذا الاختبارُ يقيسُ التصنيفَ
  // بأثرِ السياسةِ لا بالإذنِ النافذِ، في الاتجاهينِ.
  const currentBundle = loadPolicyBundle();
  const sovereign = policyById(currentBundle.policies, 'pol:king-sovereign-acts');
  const denyExport = policyById(currentBundle.policies, 'pol:forbid-key-export');
  const request = {
    actor: { id: 'actor:probe', role: 'role:king', state: 'active' },
    action: 'stop-state',
    resource: { type: 'state', id: 'all' },
    royalCommandId: 'cmd:sim-0001',
    royalCommandDigest: 'a'.repeat(64),
  };
  /** @type {import('../../src/policy/simulator.mjs').RecordedPolicyDecision} */
  const record = {
    request,
    allowed: false,
    code: 'SOVEREIGN_COMMAND_VERIFICATION_REQUIRED',
    policyId: 'pol:king-sovereign-acts',
    policyVersion: sovereign.version,
    recordedAt: new Date(),
  };
  /**
   * @param {PolicyRecord} policy
   */
  const withPolicy = (policy) => {
    const replacement = new Map([[policy.id, policy]]);
    return Object.freeze({
      ...currentBundle,
      policies: Object.freeze(
        currentBundle.policies.map((candidate) => replacement.get(candidate.id) ?? candidate),
      ),
    });
  };
  // الاتجاهُ الأولُ: سماحٌ سياديٌّ (تأجيلٌ) يتحوّلُ إلى منعٍ — يظهرُ `allowToDeny`.
  const deniedSovereign = withPolicy({ ...sovereign, effect: /** @type {const} */ ('deny') });
  const toDeny = simulatePolicyChange({
    recorded: [record],
    currentBundle,
    proposedBundle: deniedSovereign,
  });
  assert.equal(toDeny.allowToDeny, 1, 'تحويلُ سماحٍ سياديٍّ إلى منعٍ لم يظهر في الأثر');
  assert.equal(toDeny.unchanged, 0);

  // الاتجاهُ الثانيُ: منعٌ سياديٌّ (المفتاحُ المطلقُ) يتحوّلُ إلى سماحٍ — يظهرُ `denyToAllow`.
  const exportRequest = {
    ...request,
    action: 'export-keys',
    royalCommandId: 'cmd:sim-0002',
  };
  /** @type {import('../../src/policy/simulator.mjs').RecordedPolicyDecision} */
  const exportRecord = {
    request: exportRequest,
    allowed: false,
    code: 'POLICY_DENY',
    policyId: denyExport.id,
    policyVersion: denyExport.version,
    recordedAt: new Date(),
  };
  const allowedExport = withPolicy({ ...denyExport, effect: /** @type {const} */ ('allow') });
  const toAllow = simulatePolicyChange({
    recorded: [exportRecord],
    currentBundle,
    proposedBundle: allowedExport,
  });
  assert.equal(toAllow.denyToAllow, 1, 'تحويلُ منعٍ سياديٍّ إلى سماحٍ لم يظهر في الأثر');
  assert.equal(toAllow.unchanged, 0);
});
