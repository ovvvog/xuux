/**
 * اختبارات بوابة تخصيص الميزانية — LIM-2
 *
 * يُثبِتُ الاختبارُ شطرَي الإغلاق:
 *   (أ) التخصيصُ المأذونُ يَمرُّ بنقطةِ التفويضِ ويُقيِّدُ المبلغَ ويُسجِّلُ أثراً.
 *   (ب) التخصيصُ غيرُ المأذونِ يُرفَضُ برمزٍ ولا يُقيَّدُ شيء.
 *   (ج) مؤسسةٌ غيرُ مُؤسَّسةٍ تُرفَضُ قبلَ التفويضِ.
 *   (د) مبلغٌ غيرُ صالحٍ يُرفَضُ قبلَ التفويضِ.
 *   (هـ) التذكرةُ غيرُ الصالحةِ تُرفَضُ ولا يُقيَّدُ شيء.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BudgetError,
  BUDGET_ACTION,
  BUDGET_ERRORS,
  createBudgetGate,
} from '../../src/institutions/budget-gate.mjs';

/** @typedef {{ id: string, key: string, budgetAllocated: number, budgetConsumed: number, budgetResource: string }} InstitutionRow */

/**
 * مصنعُ مؤسساتٍ اختباريٌّ يَحفظُ الصفوفَ في الذاكرة.
 * @returns {{
 *   list: (opts: { filter: { key: string }, limit: number }) => Promise<InstitutionRow[]>,
 *   update: (id: string, fields: Record<string, unknown>) => Promise<InstitutionRow>,
 *   _rows: Map<string, InstitutionRow>,
 * }}
 */
function fakeInstitutions() {
  /** @type {Map<string, InstitutionRow>} */
  const rows = new Map();

  return {
    _rows: rows,
    /** @param {{ filter: { key: string }, limit: number }} opts */
    async list({ filter, limit }) {
      const all = [...rows.values()];
      const matched = all.filter((r) => r.key === filter.key);
      return matched.slice(0, limit);
    },
    /** @param {string} id @param {Record<string, unknown>} fields */
    async update(id, fields) {
      const row = rows.get(id);
      if (row === undefined) throw new Error(`المؤسسة ${id} غير موجودة`);
      const updated = { ...row, ...fields };
      rows.set(id, updated);
      return updated;
    },
  };
}

/**
 * نقطةُ تفويضٍ اختباريّةٌ تَحفظُ القراراتِ.
 * @param {{ allowed?: boolean, code?: string, reason?: string, verifyFails?: boolean }} [opts]
 */
function fakeEnforcementPoint(opts = {}) {
  const { allowed = true, code = 'ALLOWED', reason = '', verifyFails = false } = opts;
  /** @type {Array<{ request: unknown, measurement: unknown }>} */
  const authorizations = [];
  /** @type {Array<{ token: unknown, binding: unknown }>} */
  const verifications = [];

  return /** @type {any} */ ({
    _authorizations: authorizations,
    _verifications: verifications,
    /** @param {unknown} request @param {Record<string, unknown>} [measurement] */
    async authorize(request, measurement = {}) {
      authorizations.push({ request, measurement });
      return {
        decision: Object.freeze({
          allowed,
          effect: allowed ? 'allow' : 'deny',
          code,
          reason,
          policyId: 'test-policy',
          policyVersion: '1.0.0',
          requiresRoyalCommand: false,
          matched: Object.freeze([]),
          evaluatedAt: '2026-09-16T00:00:00.000Z',
        }),
        token: allowed ? 'test-token' : null,
        quota: null,
      };
    },
    /** @param {unknown} token @param {unknown} binding */
    verify(token, binding) {
      verifications.push({ token, binding });
      if (verifyFails) {
        throw new Error('تذكرة غير صالحة');
      }
    },
    async settleQuota() {},
  });
}

/**
 * سجلٌّ اختباريٌّ يَحفظُ الحوادثَ.
 */
function fakeLog() {
  /** @type {Array<{ type: string, actor: string, payload: object }>} */
  const entries = [];
  return {
    _entries: entries,
    /** @param {string} type @param {string} actor @param {object} payload */
    append(type, actor, payload) {
      entries.push({ type, actor, payload });
    },
  };
}

describe('بوابة تخصيص الميزانية', () => {
  it('التخصيصُ المأذونُ يَمرُّ بنقطةِ التفويضِ ويُقيِّدُ المبلغَ ويُسجِّلُ أثراً', async () => {
    const institutions = fakeInstitutions();
    const inst = {
      id: 'inst:001',
      key: 'treasury',
      budgetAllocated: 1000,
      budgetConsumed: 200,
      budgetResource: 'budget-allocated',
    };
    institutions._rows.set('inst:001', inst);

    const ep = fakeEnforcementPoint({ allowed: true });
    const log = fakeLog();
    const gate = createBudgetGate({
      enforcementPoint: ep,
      log,
      institutions,
      now: () => new Date('2026-09-16T00:00:00Z'),
    });

    const result = await gate.allocate({
      actor: { id: 'role:king', role: 'king', state: 'active', kind: 'human', capabilities: [] },
      institutionKey: 'treasury',
      amount: 500,
      purpose: 'تمويل مشروع البنية التحتية',
    });

    assert.equal(result.institutionKey, 'treasury');
    assert.equal(result.amount, 500);
    assert.equal(result.purpose, 'تمويل مشروع البنية التحتية');

    // التفويضُ استُدعيَ بالفعلِ والمبلغِ في قناةِ القياسِ.
    assert.equal(ep._authorizations.length, 1);
    assert.equal(ep._authorizations[0].request.action, BUDGET_ACTION);
    assert.equal(ep._authorizations[0].measurement.measured.budgetUnits, 500);

    // التذكرةُ استُهلِكَت.
    assert.equal(ep._verifications.length, 1);

    // الميزانيةُ قُيِّدَت في الصف.
    const updated = institutions._rows.get('inst:001');
    assert.equal(updated?.budgetAllocated, 1500);

    // الأثرُ سُجِّل.
    const allocLog = log._entries.find((e) => e.type === 'institutions.budget.allocated');
    assert.ok(allocLog, 'لم يُسجَّل أثر التخصيص');
    assert.equal(/** @type {Record<string, unknown>} */ (allocLog.payload).amount, 500);
  });

  it('التخصيصُ غيرُ المأذونِ يُرفَضُ برمزٍ ولا يُقيَّدُ شيء', async () => {
    const institutions = fakeInstitutions();
    institutions._rows.set('inst:001', {
      id: 'inst:001',
      key: 'treasury',
      budgetAllocated: 1000,
      budgetConsumed: 0,
      budgetResource: 'budget-allocated',
    });

    const ep = fakeEnforcementPoint({
      allowed: false,
      code: 'QUOTA_EXCEEDED',
      reason: 'الحد الشهري مُستنفد',
    });
    const log = fakeLog();
    const gate = createBudgetGate({ enforcementPoint: ep, log, institutions });

    await assert.rejects(
      () =>
        gate.allocate({
          actor: {
            id: 'role:king',
            role: 'king',
            state: 'active',
            kind: 'human',
            capabilities: [],
          },
          institutionKey: 'treasury',
          amount: 500,
        }),
      (err) => {
        assert.ok(err instanceof BudgetError);
        assert.equal(err.code, BUDGET_ERRORS.NOT_AUTHORIZED);
        return true;
      },
    );

    // الميزانية لم تُقيَّد.
    const row = institutions._rows.get('inst:001');
    assert.equal(row?.budgetAllocated, 1000);

    // الرفض سُجِّل.
    const refuseLog = log._entries.find((e) => e.type === 'institutions.budget.refused');
    assert.ok(refuseLog, 'لم يُسجَّل أثر الرفض');
  });

  it('مؤسسةٌ غيرُ مُؤسَّسةٍ تُرفَضُ قبلَ التفويضِ', async () => {
    const institutions = fakeInstitutions();
    const ep = fakeEnforcementPoint();
    const log = fakeLog();
    const gate = createBudgetGate({ enforcementPoint: ep, log, institutions });

    await assert.rejects(
      () =>
        gate.allocate({
          actor: {
            id: 'role:king',
            role: 'king',
            state: 'active',
            kind: 'human',
            capabilities: [],
          },
          institutionKey: 'nonexistent',
          amount: 500,
        }),
      (err) => {
        assert.ok(err instanceof BudgetError);
        assert.equal(err.code, BUDGET_ERRORS.INSTITUTION_UNKNOWN);
        return true;
      },
    );

    // التفويضُ لم يُستدعَ.
    assert.equal(ep._authorizations.length, 0);
  });

  it('مبلغٌ غيرُ صالحٍ يُرفَضُ قبلَ التفويضِ', async () => {
    const institutions = fakeInstitutions();
    institutions._rows.set('inst:001', {
      id: 'inst:001',
      key: 'treasury',
      budgetAllocated: 1000,
      budgetConsumed: 0,
      budgetResource: 'budget-allocated',
    });
    const ep = fakeEnforcementPoint();
    const log = fakeLog();
    const gate = createBudgetGate({ enforcementPoint: ep, log, institutions });

    await assert.rejects(
      () =>
        gate.allocate({
          actor: {
            id: 'role:king',
            role: 'king',
            state: 'active',
            kind: 'human',
            capabilities: [],
          },
          institutionKey: 'treasury',
          amount: -100,
        }),
      (err) => {
        assert.ok(err instanceof BudgetError);
        assert.equal(err.code, BUDGET_ERRORS.AMOUNT_INVALID);
        return true;
      },
    );

    assert.equal(ep._authorizations.length, 0);
  });

  it('التذكرةُ غيرُ الصالحةِ تُرفَضُ ولا يُقيَّدُ شيء', async () => {
    const institutions = fakeInstitutions();
    institutions._rows.set('inst:001', {
      id: 'inst:001',
      key: 'treasury',
      budgetAllocated: 1000,
      budgetConsumed: 0,
      budgetResource: 'budget-allocated',
    });
    const ep = fakeEnforcementPoint({ allowed: true, verifyFails: true });
    const log = fakeLog();
    const gate = createBudgetGate({ enforcementPoint: ep, log, institutions });

    await assert.rejects(
      () =>
        gate.allocate({
          actor: {
            id: 'role:king',
            role: 'king',
            state: 'active',
            kind: 'human',
            capabilities: [],
          },
          institutionKey: 'treasury',
          amount: 500,
        }),
      (err) => {
        assert.ok(err instanceof BudgetError);
        assert.equal(err.code, BUDGET_ERRORS.TICKET_INVALID);
        return true;
      },
    );

    // الميزانية لم تُقيَّد.
    const row = institutions._rows.get('inst:001');
    assert.equal(row?.budgetAllocated, 1000);
  });
});
