/**
 * اختبارات حوكمة نسخة السياسة — M4.06.
 *
 * لا يكفي هنا اختبار كائنات في الذاكرة: القيد الذي يمنع نسختين نافذتين أو تنشيطاً
 * بلا اعتماد يجب أن يثبت على PostgreSQL نفسها، لأن الكاتب المباشر في القاعدة لا
 * يمر بالضرورة بوحدة JavaScript.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { KingIdentity } from '../../src/root-of-trust/identity.mjs';
import { PolicyDecisionPoint } from '../../src/policy/engine.mjs';
import { loadPolicyBundle } from '../../src/policy/loader.mjs';
import {
  createPolicyVersionStore,
  POLICY_GOVERNANCE_ERRORS,
  policyApprovalPayload,
  policyRollbackPayload,
} from '../../src/policy/versioning.mjs';
import { up } from '../../src/persistence/migrator.mjs';
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

/** @returns {import('../../src/policy/model.mjs').PolicyRequest} */
function registryReadRequest() {
  return {
    actor: {
      id: 'agent:policy-versioning',
      role: 'role:operator',
      state: 'active',
      scope: 'institution:tech',
    },
    action: 'read-registry',
    resource: { type: 'registry', id: 'agents' },
  };
}

test(
  'رفض التنشيط غير المعتمد والتوقيع المزور، ونسخة نافذة واحدة، والتراجع يعيد قرار المحرك',
  { skip: skipWithoutDatabase },
  async () => {
    const isolated = await createIsolatedDatabase('polvers');
    try {
      await up(isolated.pool, { appliedBy: 'tests:policy-versioning' });
      const king = new KingIdentity();
      const store = createPolicyVersionStore({ pool: isolated.pool, signer: king });
      const baseBundle = loadPolicyBundle();
      const baseline = policyById(baseBundle.policies, 'pol:read-registry-authorized-roles');

      const first = await store.propose({
        policy: baseline,
        reason: 'تثبيت النسخة المرجعية قبل اختبار تعديلها.',
        proposedBy: 'agent:proposer',
      });

      await assert.rejects(
        store.activate({ policyId: first.policyId, version: first.version }),
        /** @param {unknown} error */ (error) =>
          error instanceof Error &&
          /** @type {{ code?: unknown }} */ (error).code ===
            POLICY_GOVERNANCE_ERRORS.CHANGE_UNAPPROVED,
      );

      const forged = await store.propose({
        policy: { ...baseline, reason: 'تعديل لا يجب أن يمر بتوقيع مزوّر.' },
        reason: 'مسودة لاختبار توقيع مزوّر.',
        proposedBy: 'agent:proposer',
      });
      await assert.rejects(
        store.approve({
          policyId: forged.policyId,
          version: forged.version,
          approvedBy: king.id,
          signature: 'forged-signature',
        }),
        /** @param {unknown} error */ (error) =>
          error instanceof Error &&
          /** @type {{ code?: unknown }} */ (error).code ===
            POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
      );

      const firstSignature = king.sign(
        policyApprovalPayload({
          policyId: first.policyId,
          version: first.version,
          policy: first.policy,
          approvedBy: king.id,
        }),
      );
      await store.approve({
        policyId: first.policyId,
        version: first.version,
        approvedBy: king.id,
        signature: firstSignature,
      });

      const baselineDecision = new PolicyDecisionPoint({
        bundle: await store.bundleWithOverrides(baseBundle),
      }).evaluate(registryReadRequest());
      assert.equal(baselineDecision.allowed, true);

      const changed = await store.propose({
        policy: {
          ...baseline,
          effect: 'deny',
          priority: 1_000,
          reason: 'اختبار: هذه النسخة تمنع القراءة التي كانت مسموحة.',
        },
        reason: 'اختبار أثر منع القراءة ثم التراجع.',
        proposedBy: 'agent:proposer',
      });
      const changedSignature = king.sign(
        policyApprovalPayload({
          policyId: changed.policyId,
          version: changed.version,
          policy: changed.policy,
          approvedBy: king.id,
        }),
      );
      await store.approve({
        policyId: changed.policyId,
        version: changed.version,
        approvedBy: king.id,
        signature: changedSignature,
      });

      const changedDecision = new PolicyDecisionPoint({
        bundle: await store.bundleWithOverrides(baseBundle),
      }).evaluate(registryReadRequest());
      assert.equal(changedDecision.allowed, false);
      assert.equal(changedDecision.code, 'POLICY_DENY');

      const activeCount = await isolated.pool.query(
        'SELECT count(*)::integer AS count FROM state.policy_versions WHERE policy_id = $1 AND active',
        [baseline.id],
      );
      assert.equal(Number(activeCount.rows[0]?.['count']), 1);

      const rollbackReason = 'تراجع اختباري يعيد النسخة المرجعية وسلوكها السابق.';
      const rollbackSignature = king.sign(
        policyRollbackPayload({
          policyId: baseline.id,
          toVersion: first.version,
          policy: first.policy,
          approvedBy: king.id,
          reason: rollbackReason,
        }),
      );
      const rolledBack = await store.rollback({
        policyId: baseline.id,
        toVersion: first.version,
        approvedBy: king.id,
        signature: rollbackSignature,
        reason: rollbackReason,
      });
      assert.equal(rolledBack.active, true);
      assert.equal(rolledBack.version, 4);

      const restoredDecision = new PolicyDecisionPoint({
        bundle: await store.bundleWithOverrides(baseBundle),
      }).evaluate(registryReadRequest());
      assert.equal(restoredDecision.allowed, baselineDecision.allowed);
      assert.equal(restoredDecision.code, baselineDecision.code);

      const history = await store.history(baseline.id);
      assert.equal(history.length, 4);
      assert.equal(history.filter((version) => version.active).length, 1);
      assert.equal(history.at(-1)?.reason, rollbackReason);
    } finally {
      await isolated.drop();
    }
  },
);
