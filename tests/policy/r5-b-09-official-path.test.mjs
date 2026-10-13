// R5-B-09 (تقرير: R5-B-07) — المسارُ الرسميُّ كاملًا (composeEnforcementChain
// + identityGate موصولةٌ + policy engine) — اختبارُ رجوعٍ لقيد WL-382.
//
// قبلَ WL-382 كانَ هذا السيناريو يُسجَّلُ `NOT_TESTED` لأنّ المسبارَ كانَ يستعملُ
// معرّفَ فاعلٍ غيرِ مسجَّلٍ في السجلِّ الرسميِّ (minister:9) فتسبقُهُ بوابةُ
// الهويةِ (IDENTITY_UNVERIFIED) قبلَ أن يُقيَّسَ ضابطُ سقفِ القدرةِ نفسُهُ.
// هنا: فاعلٌ مُسجَّلٌ بالسجلِّ الرسميِّ (register → شهادة → state=active)
// بقدراتٍ فارغةٍ، وضابطٌ مسجَّلٌ بقدرةِ كتابةٍ يمرُّ — فالرفضُ إن وقعَ فهو
// من ضابطِ سقفِ القدرةِ لا من بوابةِ الهويةِ.

import assert from 'node:assert/strict';
import test from 'node:test';
import { composeEnforcementChain } from '../../src/core/composition-root.mjs';

/** سجلُّ أحداثٍ صغيرٌ للقياس. */
function memoryLog() {
  /** @type {{ type: string, actor: string, payload: object }[]} */
  const events = [];
  return {
    events,
    /**
     * @param {string} type
     * @param {string} actor
     * @param {object} payload
     */
    append(type, actor, payload) {
      events.push({ type, actor, payload });
    },
  };
}

test('R5-B-09 عبرَ المسارِ الرسميِّ: فاعلٌ مسجَّلٌ بقدراتٍ فارغةٍ يُرفضُ عندَ سقفِ القدرةِ لا عندَ بوابةِ الهويةِ', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });
  const agent = await chain.registry.register({
    name: 'r5b09-official-path-no-cap',
    role: 'role:agent',
    capabilities: [],
    kind: 'autonomous',
  });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, false, 'الرفضُ مطلوبٌ');
  assert.equal(
    result.decision.code,
    'POLICY_NO_MATCH',
    'الرفضُ من ضابطِ سقفِ القدرةِ (السياسةِ)، لا من بوابةِ الهويةِ',
  );
  assert.notEqual(
    result.decision.code,
    'IDENTITY_UNVERIFIED',
    'الفاعلُ مُسجَّلٌ فلا يُرفَضُ من بوابةِ الهويةِ',
  );
});

test('R5-B-09 عبرَ المسارِ الرسميِّ: الضابطُ — فاعلٌ مسجَّلٌ بقدرةِ كتابةٍ يُؤذَنُ (لا يُكسَرُ السلوكُ المشروعُ)', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });
  const agent = await chain.registry.register({
    name: 'r5b09-official-path-with-cap',
    role: 'role:agent',
    capabilities: ['action:write-data'],
    kind: 'autonomous',
  });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: agent.id, kind: 'autonomous', role: 'role:agent', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, true, 'الفاعلُ بقدرةِ كتابةٍ مسجَّلٌ يُؤذَنُ');
  assert.equal(result.decision.code, 'POLICY_ALLOW');
});

test('R5-B-09 عبرَ المسارِ الرسميِّ: فاعلٌ غيرُ مسجَّلٍ يُرفَضُ من بوابةِ الهويةِ أصلًا (حدٌّ لا يُختلطُ بضابطِ القدرةِ)', async () => {
  const chain = composeEnforcementChain({ log: memoryLog() });

  const result = await chain.enforcementPoint.authorize({
    actor: { id: 'minister:9', kind: 'human', role: 'role:minister', state: 'active' },
    action: 'write-data',
    resource: { type: 'data', id: 'doc:1' },
    context: {},
  });

  assert.equal(result.decision.allowed, false);
  assert.equal(
    result.decision.code,
    'IDENTITY_UNVERIFIED',
    'غيرُ المُسجَّلِ يُرفَضُ من الهويةِ — وهذا سلوكٌ سليمٌ لا يُقاسُ بضابطِ القدرةِ',
  );
});
