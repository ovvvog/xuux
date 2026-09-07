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

/**
 * يلفّ فاحص توقيعٍ ويعُدُّ نداءاتِ `verify`، لأنّ عيبَ `GPT-F02` كانَ أنّ `verify`
 * لم يُستدعَ إطلاقاً عندَ القراءةِ. فإثباتُ نداءِه هو صميمُ الانحسار.
 * @param {import('../../src/policy/versioning.mjs').PolicySigner} inner
 * @returns {import('../../src/policy/versioning.mjs').PolicySigner & { _verifyCalls: () => number }}
 */
function recordingSigner(inner) {
  let verifyCalls = 0;
  const wrapper = {
    verify(/** @type {object} */ payload, /** @type {string} */ signature) {
      verifyCalls += 1;
      return inner.verify(payload, signature);
    },
  };
  return Object.assign(wrapper, {
    _verifyCalls: () => verifyCalls,
  });
}

/**
 * تجمّعٌ وهميٌّ يُعيدُ صفوفاً معلَّبةً لاستعلامِ النسخِ الناشطةِ وحدَه، كي يُختبرَ
 * `bundleWithOverrides` بلا اعتمادٍ على PostgreSQL — فإعادةُ التحقّقِ والتجميدُ
 * العميقُ منطقٌ خالصٌ يُثبتُ هنا.
 * @param {Record<string, unknown>[]} rows
 * @returns {import('pg').Pool}
 */
function fakePoolForActive(rows) {
  const pool = {
    /** @param {string} sql */
    async query(sql) {
      if (sql.includes('WHERE active = true')) return { rows };
      throw new Error(`fakePoolForActive: استعلامٌ غيرُ متوقَّع: ${sql.slice(0, 80)}`);
    },
  };
  // طبيعٌ مُحدَّدٌ: لا نمرُّ في معاملة، ولا نستدعي إلا `query` للاستعلامِ الناشطِ.
  return /** @type {import('pg').Pool} */ (/** @type {unknown} */ (pool));
}

/**
 * يبني صفَّ اعتمادٍ نشطاً مطابقاً لِما يُنتِجُه `approve` على القاعدة.
 * @param {{ policyId: string, version: number, document: object, approvedBy: string, signature: string }} input
 * @returns {Record<string, unknown>}
 */
function approvalRow({ policyId, version, document, approvedBy, signature }) {
  return {
    policy_id: policyId,
    version,
    document,
    change_reason: 'سببٌ اختباريٌّ للاعتماد.',
    proposed_by: 'agent:proposer',
    approved_by: approvedBy,
    approval_signature: signature,
    active: true,
    created_at: new Date(),
    signature_kind: 'approval',
    rollback_from_version: null,
  };
}

/**
 * يبني صفَّ تراجعٍ نشطاً مطابقاً لِما يُنتِجُه `rollback` (version=nextVersion،
 * rollback_from_version=toVersion، signature_kind='rollback').
 * @param {{ policyId: string, version: number, rollbackFromVersion: number, document: object, approvedBy: string, signature: string, reason: string }} input
 * @returns {Record<string, unknown>}
 */
function rollbackRow({
  policyId,
  version,
  rollbackFromVersion,
  document,
  approvedBy,
  signature,
  reason,
}) {
  return {
    policy_id: policyId,
    version,
    document,
    change_reason: reason,
    proposed_by: 'agent:proposer',
    approved_by: approvedBy,
    approval_signature: signature,
    active: true,
    created_at: new Date(),
    signature_kind: 'rollback',
    rollback_from_version: rollbackFromVersion,
  };
}

test('GPT-F02: إعادةُ التحقّقِ من التوقيعِ عندَ القراءةِ لا عندَ الاعتمادِ وحدَه — fake pool', async () => {
  const king = new KingIdentity();
  const signer = recordingSigner(king);
  const baseBundle = loadPolicyBundle();
  const baseline = policyById(baseBundle.policies, 'pol:read-registry-authorized-roles');
  const document = { ...baseline, version: 1, enabled: false };
  const signature = king.sign(
    policyApprovalPayload({
      policyId: baseline.id,
      version: 1,
      policy: document,
      approvedBy: king.id,
    }),
  );
  const validRow = approvalRow({
    policyId: baseline.id,
    version: 1,
    document,
    approvedBy: king.id,
    signature,
  });

  // (1) صفُّ اعتمادٍ صحيحٌ يُدمَجُ، و`verify` استُدعيَ مرةً واحدةً على الأقلّ.
  const store = createPolicyVersionStore({ pool: fakePoolForActive([validRow]), signer });
  const bundle = await store.bundleWithOverrides(baseBundle);
  const override = bundle.policies.find((p) => p.id === baseline.id);
  assert.ok(override, 'السياسة المُعاد استخدامُها يجب أن تكون في الحزمة');
  assert.equal(override.version, 1);
  assert.equal(override.enabled, true);
  assert.ok(signer._verifyCalls() >= 1, 'يجب أن يُستدعى verify عند القراءة (GPT-F02)');

  // (2) GPT-F03 عبر مسارِ القاعدةِ: السياسةُ المعادُ استخدامُها مجمَّدةٌ تجميداً
  // عميقاً، فلا يُغيِّرُ `push`/`splice` القرارَ بعدَ التحقّقِ.
  assert.throws(() => {
    /** @type {any} */ (override.actions).push('read-audit');
  }, TypeError);
  assert.throws(() => {
    /** @type {any} */ (override.actors.roles).push('role:ghost');
  }, TypeError);
});

test('GPT-F02: توقيعٌ ملفَّقٌ أو وثيقةٌ مُبدَّلةٌ أو معتمدٌ مُبدَّلٌ — يُرفضُ مغلقًا قبلَ المحرّكِ', async () => {
  const king = new KingIdentity();
  const baseBundle = loadPolicyBundle();
  const baseline = policyById(baseBundle.policies, 'pol:read-registry-authorized-roles');
  const document = { ...baseline, version: 1, enabled: false };
  const validSignature = king.sign(
    policyApprovalPayload({
      policyId: baseline.id,
      version: 1,
      policy: document,
      approvedBy: king.id,
    }),
  );

  // (أ) توقيعٌ ملفَّقٌ لا يتحقّقُ فيُرفضُ.
  const forged = approvalRow({
    policyId: baseline.id,
    version: 1,
    document,
    approvedBy: king.id,
    signature: 'forged-signature-not-valid',
  });
  const storeForged = createPolicyVersionStore({ pool: fakePoolForActive([forged]), signer: king });
  await assert.rejects(
    storeForged.bundleWithOverrides(baseBundle),
    /** @param {unknown} error */ (error) =>
      error instanceof Error &&
      /** @type {{ code?: unknown }} */ (error).code === POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
  );

  // (ب) تلاعبٌ بالوثيقةِ بعدَ التوقيعِ (تغييرُ `reason` يُغيِّرُ الملخصَ) فيُرفضُ.
  const tamperedDocument = { ...document, reason: 'وُثّقت بلا تصريح ثم بُدِّل سببها.' };
  const tampered = approvalRow({
    policyId: baseline.id,
    version: 1,
    document: tamperedDocument,
    approvedBy: king.id,
    signature: validSignature,
  });
  const storeTampered = createPolicyVersionStore({
    pool: fakePoolForActive([tampered]),
    signer: king,
  });
  await assert.rejects(
    storeTampered.bundleWithOverrides(baseBundle),
    /** @param {unknown} error */ (error) =>
      error instanceof Error &&
      /** @type {{ code?: unknown }} */ (error).code === POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
  );

  // (ج) تبديلُ المعتمدِ بعدَ التوقيعِ فيُرفضُ (المعتمدُ جزءٌ من الظرفِ).
  const swappedApprover = approvalRow({
    policyId: baseline.id,
    version: 1,
    document,
    approvedBy: 'impostor:king',
    signature: validSignature,
  });
  const storeSwapped = createPolicyVersionStore({
    pool: fakePoolForActive([swappedApprover]),
    signer: king,
  });
  await assert.rejects(
    storeSwapped.bundleWithOverrides(baseBundle),
    /** @param {unknown} error */ (error) =>
      error instanceof Error &&
      /** @type {{ code?: unknown }} */ (error).code === POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
  );

  // (د) صفٌّ نشطٌ بلا توقيعٍ يُرفضُ (دفاعٌ في العمقِ، وإن منعتِ القاعدةُ الحالةَ).
  const missingSignature = {
    ...approvalRow({
      policyId: baseline.id,
      version: 1,
      document,
      approvedBy: king.id,
      signature: 'placeholder',
    }),
    approval_signature: null,
  };
  const storeMissing = createPolicyVersionStore({
    pool: fakePoolForActive([missingSignature]),
    signer: king,
  });
  await assert.rejects(
    storeMissing.bundleWithOverrides(baseBundle),
    /** @param {unknown} error */ (error) =>
      error instanceof Error &&
      /** @type {{ code?: unknown }} */ (error).code === POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
  );
});

test('GPT-F02: صفُّ تراجعٍ صحيحٌ يُعادُ بناءُ ظرفِه من الصفِّ فيُدمَجُ', async () => {
  const king = new KingIdentity();
  const baseBundle = loadPolicyBundle();
  const baseline = policyById(baseBundle.policies, 'pol:read-registry-authorized-roles');
  const rollbackReason = 'تراجعٌ اختباريٌّ يعيدُ النسخةَ المرجعيّةَ.';
  // سياسةُ الهدفِ الموقَّعةُ (version: toVersion=1)؛ والوثيقةُ المخزَّنةُ في صفِّ
  // التراجعِ تحمِلُ version: nextVersion=4، فيُعادُ بناؤُها بإرجاعِ version إلى 1.
  const signedPolicy = { ...baseline, version: 1, enabled: false };
  const storedDocument = { ...baseline, version: 4, enabled: false };
  const rollbackSignature = king.sign(
    policyRollbackPayload({
      policyId: baseline.id,
      toVersion: 1,
      policy: signedPolicy,
      approvedBy: king.id,
      reason: rollbackReason,
    }),
  );
  const row = rollbackRow({
    policyId: baseline.id,
    version: 4,
    rollbackFromVersion: 1,
    document: storedDocument,
    approvedBy: king.id,
    signature: rollbackSignature,
    reason: rollbackReason,
  });

  const store = createPolicyVersionStore({ pool: fakePoolForActive([row]), signer: king });
  const bundle = await store.bundleWithOverrides(baseBundle);
  const override = bundle.policies.find((p) => p.id === baseline.id);
  assert.ok(override, 'صفُّ التراجعِ الصحيحُ يجب أن يُدمَجَ');
  assert.equal(override.version, 4);
});

test(
  'GPT-F02: تلاعبٌ مباشرٌ بقاعدةِ البياناتِ (وثيقةٌ مُبدَّلةٌ وتوقيعٌ ملفَّقٌ) — يُرفضُ قبلَ المحرّكِ',
  { skip: skipWithoutDatabase },
  async () => {
    const isolated = await createIsolatedDatabase('polf02');
    try {
      await up(isolated.pool, { appliedBy: 'tests:policy-versioning-f02' });
      const king = new KingIdentity();
      const store = createPolicyVersionStore({ pool: isolated.pool, signer: king });
      const baseBundle = loadPolicyBundle();
      const baseline = policyById(baseBundle.policies, 'pol:read-registry-authorized-roles');

      const first = await store.propose({
        policy: baseline,
        reason: 'نسخةٌ تُعتمدُ ثم يُتلاعبُ بصفِّها مباشرةً.',
        proposedBy: 'agent:proposer',
      });
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

      // (1) تلاعبٌ مباشرٌ بالوثيقةِ عبرَ SQL: تغييرُ `effect` مع إبقاءِ التوقيعِ
      // القديم. يجب أن تُعيدَ القراءةُ بناءَ الظرفِ فلا يتحقّقَ التوقيعُ.
      await isolated.pool.query(
        `UPDATE state.policy_versions
            SET document = jsonb_set(document, '{effect}', '"deny"'::jsonb)
          WHERE policy_id = $1 AND version = $2`,
        [first.policyId, first.version],
      );
      await assert.rejects(
        store.bundleWithOverrides(baseBundle),
        /** @param {unknown} error */ (error) =>
          error instanceof Error &&
          /** @type {{ code?: unknown }} */ (error).code ===
            POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
      );

      // (2) إعادةُ الوثيقةِ كما كانت، ثم توقيعٌ ملفَّقٌ مباشرةً.
      await isolated.pool.query(
        `UPDATE state.policy_versions
            SET document = $3::jsonb,
                approval_signature = 'forged-by-sql'
          WHERE policy_id = $1 AND version = $2`,
        [
          first.policyId,
          first.version,
          JSON.stringify({ ...baseline, version: first.version, enabled: false }),
        ],
      );
      await assert.rejects(
        store.bundleWithOverrides(baseBundle),
        /** @param {unknown} error */ (error) =>
          error instanceof Error &&
          /** @type {{ code?: unknown }} */ (error).code ===
            POLICY_GOVERNANCE_ERRORS.SIGNATURE_INVALID,
      );

      // (3) إصلاحُ الصفِّ يدويًّا (توقيعٌ صحيحٌ على الوثيقةِ الحاليّةِ) فيُدمَجُ من جديدٍ.
      const restoredSignature = king.sign(
        policyApprovalPayload({
          policyId: first.policyId,
          version: first.version,
          policy: { ...baseline, version: first.version, enabled: false },
          approvedBy: king.id,
        }),
      );
      await isolated.pool.query(
        `UPDATE state.policy_versions
            SET approval_signature = $3
          WHERE policy_id = $1 AND version = $2`,
        [first.policyId, first.version, restoredSignature],
      );
      const bundle = await store.bundleWithOverrides(baseBundle);
      const override = bundle.policies.find((p) => p.id === baseline.id);
      assert.ok(override, 'الصفُّ المُصلَحُ بتوقيعٍ صحيحٍ يجب أن يُدمَجَ');
    } finally {
      await isolated.drop();
    }
  },
);
